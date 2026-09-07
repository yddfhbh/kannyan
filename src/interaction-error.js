import { MessageFlags } from 'discord.js';

export const DEFAULT_INTERACTION_ERROR_MESSAGE =
  '⚠️ 요청 처리 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.';

const NON_RETRYABLE_DISCORD_CODES = new Set([10015, 10062, 40060]);

function getErrorCode(error) {
  return error?.code ?? error?.status ?? 'unknown';
}

function getInteractionType(interaction) {
  try {
    return interaction?.type ?? (interaction?.isChatInputCommand?.() ? 'chat-input' : 'unknown');
  } catch {
    return 'unknown';
  }
}

function logInteractionError(label, interaction, error) {
  try {
    console.warn(
      `[INTERACTION ERROR] ${label} command=${interaction?.commandName ?? '-'} type=${getInteractionType(interaction)} id=${interaction?.id ?? '-'} errorName=${error?.name ?? 'Error'} errorCode=${getErrorCode(error)}`
    );
  } catch {
    // Error reporting must never become an unhandled rejection itself.
  }
}

function isNonRetryableDiscordError(error) {
  const code = getErrorCode(error);
  return NON_RETRYABLE_DISCORD_CODES.has(Number(code))
    || /unknown interaction|already acknowledged|unknown webhook|token/i.test(error?.message ?? '');
}

/**
 * Best-effort response for an interaction handler failure.
 * This function intentionally never throws and never exposes the original error.
 */
export async function respondToInteractionError(
  interaction,
  error,
  content = DEFAULT_INTERACTION_ERROR_MESSAGE,
) {
  logInteractionError('handler failed', interaction, error);

  try {
    if (!interaction?.isRepliable?.() || isNonRetryableDiscordError(error)) {
      return;
    }

    if (interaction.replied) {
      // Do not overwrite a successful response with a later, unrelated failure.
      return;
    }

    if (interaction.deferred) {
      try {
        await interaction.editReply({ content });
      } catch (editError) {
        logInteractionError('failed to edit deferred error response', interaction, editError);
      }
      return;
    }

    try {
      await interaction.reply({ content, flags: MessageFlags.Ephemeral });
    } catch (replyError) {
      logInteractionError('failed to send error response', interaction, replyError);
    }
  } catch (helperError) {
    logInteractionError('error response helper failed', interaction, helperError);
  }
}
