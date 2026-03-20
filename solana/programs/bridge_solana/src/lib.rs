//! bridge_solana – Solana-side Anchor program for the Sonic ↔ Solana bridge.
//!
//! Instructions
//! ─────────────
//! 1. initialize_bridge  – Set up bridge state and create the WrappedTestToken mint.
//! 2. process_from_sonic – Verify a Wormhole VAA from Sonic and mint wrapped tokens.
//! 3. burn_and_send_back – Burn wrapped tokens and emit a Wormhole message to Sonic.

use anchor_lang::prelude::*;
use anchor_spl::{
    associated_token::AssociatedToken,
    token::{self, Burn, MintTo, Token},
    token_interface::{Mint, TokenAccount},
};
use wormhole_anchor_sdk::wormhole::{self, program::Wormhole};

declare_id!("BRDGso1ANAxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx"); // Replace with actual program ID after deploy

// ── Bridge payload constants ──────────────────────────────────────────────────
pub const ACTION_LOCK_MINT: u8   = 1; // Sonic locked → Solana mint
pub const ACTION_BURN_UNLOCK: u8 = 2; // Solana burn  → Sonic unlock

// ── Account seeds ─────────────────────────────────────────────────────────────
pub const BRIDGE_STATE_SEED: &[u8] = b"bridge_state";
pub const MINT_SEED: &[u8]         = b"wrapped_mint";
pub const WORMHOLE_EMITTER_SEED: &[u8] = b"emitter";

#[program]
pub mod bridge_solana {
    use super::*;

    // ────────────────────────────────────────────────────────────────────────
    // initialize_bridge
    // ────────────────────────────────────────────────────────────────────────
    /// Set up the bridge state PDA and create the WrappedTestToken SPL mint.
    ///
    /// * `sonic_chain_id`   – Wormhole chain id of the Sonic / EVM chain.
    /// * `sonic_emitter`    – Wormhole emitter address of BridgeSonic (bytes32).
    pub fn initialize_bridge(
        ctx: Context<InitializeBridge>,
        sonic_chain_id: u16,
        sonic_emitter: [u8; 32],
    ) -> Result<()> {
        let state = &mut ctx.accounts.bridge_state;
        state.authority        = ctx.accounts.authority.key();
        state.sonic_chain_id   = sonic_chain_id;
        state.sonic_emitter    = sonic_emitter;
        state.wrapped_mint     = ctx.accounts.wrapped_mint.key();
        state.wormhole_program = ctx.accounts.wormhole_program.key();
        state.bump             = ctx.bumps.bridge_state;
        state.mint_bump        = ctx.bumps.wrapped_mint;
        state.emitter_bump     = ctx.bumps.wormhole_emitter;
        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // process_from_sonic
    // ────────────────────────────────────────────────────────────────────────
    /// Verify a Wormhole VAA published by BridgeSonic and mint wrapped tokens
    /// to the specified recipient.
    ///
    /// The VAA payload format (matches BridgeSonic.lockAndSend):
    ///   byte  0     : action (must be ACTION_LOCK_MINT = 1)
    ///   bytes 1..32 : recipient Solana pubkey (bytes32)
    ///   bytes 33..64: amount (uint256, big-endian)
    pub fn process_from_sonic(ctx: Context<ProcessFromSonic>, vaa_hash: [u8; 32]) -> Result<()> {
        let posted_vaa = &ctx.accounts.posted_vaa;
        let state      = &ctx.accounts.bridge_state;

        // 1. Verify emitter chain and address
        require!(
            posted_vaa.emitter_chain() == state.sonic_chain_id,
            BridgeError::UntrustedChain
        );
        require!(
            posted_vaa.emitter_address() == state.sonic_emitter,
            BridgeError::UntrustedEmitter
        );

        // 2. Parse payload
        let payload = posted_vaa.data();
        require!(payload.len() == 65, BridgeError::InvalidPayloadLength);

        let action = payload[0];
        require!(action == ACTION_LOCK_MINT, BridgeError::UnexpectedAction);

        // Recipient pubkey: bytes 1..32 (0-indexed)
        let recipient_bytes: [u8; 32] = payload[1..33]
            .try_into()
            .map_err(|_| BridgeError::InvalidRecipientEncoding)?;
        let recipient = Pubkey::from(recipient_bytes);

        // Amount: bytes 33..64; treat as big-endian u256 → take last 8 bytes as u64.
        // For this prototype amounts are assumed to fit in u64.
        let amount_bytes: [u8; 8] = payload[57..65]
            .try_into()
            .map_err(|_| BridgeError::InvalidAmountEncoding)?;
        let amount = u64::from_be_bytes(amount_bytes);

        require!(amount > 0, BridgeError::ZeroAmount);
        require!(recipient == ctx.accounts.recipient_token_account.owner, BridgeError::RecipientMismatch);

        // 3. Mint wrapped tokens to the recipient's ATA
        let seeds: &[&[u8]] = &[BRIDGE_STATE_SEED, &[state.bump]];
        let signer = &[seeds];

        let cpi_ctx = CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            MintTo {
                mint:      ctx.accounts.wrapped_mint.to_account_info(),
                to:        ctx.accounts.recipient_token_account.to_account_info(),
                authority: ctx.accounts.bridge_state.to_account_info(),
            },
            signer,
        );
        token::mint_to(cpi_ctx, amount)?;

        // 4. Mark VAA as consumed to prevent replay
        ctx.accounts.vaa_consumed.vaa_hash = vaa_hash;

        emit!(TokensMinted {
            recipient,
            amount,
            vaa_hash,
        });

        Ok(())
    }

    // ────────────────────────────────────────────────────────────────────────
    // burn_and_send_back
    // ────────────────────────────────────────────────────────────────────────
    /// Burn `amount` of WrappedTestToken and publish a Wormhole message back
    /// to Sonic so that BridgeSonic can unlock the original tokens.
    ///
    /// * `amount`        – How many wrapped tokens to burn.
    /// * `recipient_evm` – 20-byte EVM address on Sonic to receive the tokens.
    /// * `nonce`         – Arbitrary nonce for the Wormhole message.
    pub fn burn_and_send_back(
        ctx: Context<BurnAndSendBack>,
        amount: u64,
        recipient_evm: [u8; 20],
        nonce: u32,
    ) -> Result<()> {
        require!(amount > 0, BridgeError::ZeroAmount);

        // 1. Burn wrapped tokens from the user's ATA
        let burn_ctx = CpiContext::new(
            ctx.accounts.token_program.to_account_info(),
            Burn {
                mint:      ctx.accounts.wrapped_mint.to_account_info(),
                from:      ctx.accounts.user_token_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            },
        );
        token::burn(burn_ctx, amount)?;

        // 2. Build the bridge payload (mirrors BridgeSonic.receiveFromSolana expectations)
        //    action (1 byte) | recipient padded to 32 bytes | amount as u256 big-endian (32 bytes)
        let mut payload = Vec::with_capacity(65);
        payload.push(ACTION_BURN_UNLOCK);
        // Pad 20-byte EVM address to 32 bytes (left-padded with zeros)
        payload.extend_from_slice(&[0u8; 12]);
        payload.extend_from_slice(&recipient_evm);
        // amount as 32-byte big-endian uint256 (last 8 bytes carry the u64)
        payload.extend_from_slice(&[0u8; 24]);
        payload.extend_from_slice(&amount.to_be_bytes());

        // 3. Post the Wormhole message
        let state   = &ctx.accounts.bridge_state;
        let seeds: &[&[u8]] = &[WORMHOLE_EMITTER_SEED, &[state.emitter_bump]];
        let signer  = &[seeds];

        wormhole::post_message(
            CpiContext::new_with_signer(
                ctx.accounts.wormhole_program.to_account_info(),
                wormhole::PostMessage {
                    config:      ctx.accounts.wormhole_config.to_account_info(),
                    message:     ctx.accounts.wormhole_message.to_account_info(),
                    emitter:     ctx.accounts.wormhole_emitter.to_account_info(),
                    sequence:    ctx.accounts.wormhole_sequence.to_account_info(),
                    payer:       ctx.accounts.user.to_account_info(),
                    fee_collector: ctx.accounts.wormhole_fee_collector.to_account_info(),
                    clock:       ctx.accounts.clock.to_account_info(),
                    rent:        ctx.accounts.rent.to_account_info(),
                    system_program: ctx.accounts.system_program.to_account_info(),
                },
                signer,
            ),
            nonce,
            payload,
            wormhole::Finality::Confirmed,
        )?;

        emit!(TokensBurned {
            user:          ctx.accounts.user.key(),
            recipient_evm,
            amount,
        });

        Ok(())
    }
}

// ── Account structs ───────────────────────────────────────────────────────────

#[derive(Accounts)]
pub struct InitializeBridge<'info> {
    #[account(mut)]
    pub authority: Signer<'info>,

    #[account(
        init,
        payer  = authority,
        space  = BridgeState::LEN,
        seeds  = [BRIDGE_STATE_SEED],
        bump
    )]
    pub bridge_state: Account<'info, BridgeState>,

    /// WrappedTestToken SPL mint, controlled by the bridge_state PDA.
    #[account(
        init,
        payer  = authority,
        seeds  = [MINT_SEED],
        bump,
        mint::decimals  = 9,
        mint::authority = bridge_state,
    )]
    pub wrapped_mint: InterfaceAccount<'info, Mint>,

    /// Wormhole emitter PDA – used as the message emitter in burn_and_send_back.
    /// CHECK: PDA verified by seeds below.
    #[account(
        init,
        payer = authority,
        space = wormhole::EmitterAccount::LEN,
        seeds = [WORMHOLE_EMITTER_SEED],
        bump,
    )]
    pub wormhole_emitter: Account<'info, wormhole::EmitterAccount>,

    pub wormhole_program: Program<'info, Wormhole>,
    pub token_program:    Program<'info, Token>,
    pub system_program:   Program<'info, System>,
    pub rent:             Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(vaa_hash: [u8; 32])]
pub struct ProcessFromSonic<'info> {
    #[account(mut)]
    pub payer: Signer<'info>,

    #[account(seeds = [BRIDGE_STATE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,

    /// Wormhole-posted VAA account (created by the Wormhole program when the VAA is submitted).
    /// CHECK: Verified via Wormhole CPI – anchor-wormhole checks the account discriminator and seeds.
    #[account(
        seeds = [
            wormhole::SEED_PREFIX_POSTED_VAA,
            &vaa_hash
        ],
        bump,
        seeds::program = bridge_state.wormhole_program,
    )]
    pub posted_vaa: Account<'info, wormhole::PostedVaaV1<Vec<u8>>>,

    /// Replay-protection account: one PDA per VAA hash.
    #[account(
        init,
        payer  = payer,
        space  = VaaConsumed::LEN,
        seeds  = [b"consumed", &vaa_hash],
        bump,
    )]
    pub vaa_consumed: Account<'info, VaaConsumed>,

    /// Wrapped token mint
    #[account(
        mut,
        address = bridge_state.wrapped_mint,
        seeds   = [MINT_SEED],
        bump    = bridge_state.mint_bump,
    )]
    pub wrapped_mint: InterfaceAccount<'info, Mint>,

    /// Recipient's associated token account for the wrapped mint.
    #[account(mut)]
    pub recipient_token_account: InterfaceAccount<'info, TokenAccount>,

    pub token_program:  Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent:           Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct BurnAndSendBack<'info> {
    #[account(mut)]
    pub user: Signer<'info>,

    #[account(seeds = [BRIDGE_STATE_SEED], bump = bridge_state.bump)]
    pub bridge_state: Account<'info, BridgeState>,

    #[account(
        mut,
        address = bridge_state.wrapped_mint,
        seeds   = [MINT_SEED],
        bump    = bridge_state.mint_bump,
    )]
    pub wrapped_mint: InterfaceAccount<'info, Mint>,

    /// User's ATA for the wrapped mint (tokens will be burned from here).
    #[account(
        mut,
        associated_token::mint      = wrapped_mint,
        associated_token::authority = user,
    )]
    pub user_token_account: InterfaceAccount<'info, TokenAccount>,

    // ── Wormhole accounts ────────────────────────────────────────────────────
    /// CHECK: Validated by Wormhole CPI.
    #[account(mut)]
    pub wormhole_config: UncheckedAccount<'info>,

    /// CHECK: New message account; must be a fresh keypair supplied by the client.
    #[account(mut)]
    pub wormhole_message: UncheckedAccount<'info>,

    /// Emitter PDA owned by this program.
    #[account(
        mut,
        seeds = [WORMHOLE_EMITTER_SEED],
        bump  = bridge_state.emitter_bump,
    )]
    pub wormhole_emitter: Account<'info, wormhole::EmitterAccount>,

    /// CHECK: Validated by Wormhole CPI.
    #[account(mut)]
    pub wormhole_sequence: UncheckedAccount<'info>,

    /// CHECK: Validated by Wormhole CPI.
    #[account(mut)]
    pub wormhole_fee_collector: UncheckedAccount<'info>,

    pub wormhole_program: Program<'info, Wormhole>,
    pub token_program:    Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program:   Program<'info, System>,
    pub clock:            Sysvar<'info, Clock>,
    pub rent:             Sysvar<'info, Rent>,
}

// ── State accounts ────────────────────────────────────────────────────────────

#[account]
pub struct BridgeState {
    /// Authority that initialized the bridge.
    pub authority: Pubkey,
    /// Wormhole chain id of the trusted EVM / Sonic chain.
    pub sonic_chain_id: u16,
    /// Wormhole emitter address of BridgeSonic (bytes32).
    pub sonic_emitter: [u8; 32],
    /// Public key of the WrappedTestToken mint PDA.
    pub wrapped_mint: Pubkey,
    /// Wormhole program id stored for convenience.
    pub wormhole_program: Pubkey,
    /// Bumps
    pub bump: u8,
    pub mint_bump: u8,
    pub emitter_bump: u8,
}

impl BridgeState {
    pub const LEN: usize = 8        // discriminator
        + 32                        // authority
        + 2                         // sonic_chain_id
        + 32                        // sonic_emitter
        + 32                        // wrapped_mint
        + 32                        // wormhole_program
        + 1 + 1 + 1;                // bumps
}

/// Replay-protection record: one account per consumed VAA.
#[account]
pub struct VaaConsumed {
    pub vaa_hash: [u8; 32],
}

impl VaaConsumed {
    pub const LEN: usize = 8 + 32;
}

// ── Events ────────────────────────────────────────────────────────────────────

#[event]
pub struct TokensMinted {
    pub recipient: Pubkey,
    pub amount:    u64,
    pub vaa_hash:  [u8; 32],
}

#[event]
pub struct TokensBurned {
    pub user:          Pubkey,
    pub recipient_evm: [u8; 20],
    pub amount:        u64,
}

// ── Errors ────────────────────────────────────────────────────────────────────

#[error_code]
pub enum BridgeError {
    #[msg("VAA emitter chain does not match trusted Sonic chain")]
    UntrustedChain,
    #[msg("VAA emitter address does not match trusted BridgeSonic emitter")]
    UntrustedEmitter,
    #[msg("Payload length is not 65 bytes")]
    InvalidPayloadLength,
    #[msg("Payload action is not ACTION_LOCK_MINT (1)")]
    UnexpectedAction,
    #[msg("Amount must be greater than zero")]
    ZeroAmount,
    #[msg("Recipient in VAA does not match supplied token account owner")]
    RecipientMismatch,
    #[msg("Failed to decode recipient pubkey from payload")]
    InvalidRecipientEncoding,
    #[msg("Failed to decode amount from payload")]
    InvalidAmountEncoding,
}
