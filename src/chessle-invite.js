export const CHESSLE_INVITE_BUTTON = 'chessle:open:v1';

export function buildChessleInvitePayload() {
  return {
    content: '♟️ **Chessle 게임 초대**\nChessle이 시작됐어요! 아래 버튼을 눌러 게임에 참가해 보세요.',
    components: [
      {
        type: 1,
        components: [
          {
            type: 2,
            style: 1,
            custom_id: CHESSLE_INVITE_BUTTON,
            label: '게임 시작',
          },
        ],
      },
    ],
    allowedMentions: { parse: [] },
  };
}

export async function handleChessleInviteInteraction(interaction) {
  // An existing invite button launches the Activity.
  // Do not post a duplicate invitation when joining.
  if (
    interaction.isButton?.() &&
    interaction.customId === CHESSLE_INVITE_BUTTON
  ) {
    await interaction.launchActivity();
    return true;
  }

  const slash =
    interaction.isChatInputCommand?.() &&
    interaction.commandName === '체슬';

  // Also support the Activity Entry Point if its handler
  // is changed to APP_HANDLER in a later deployment.
  const entry =
    interaction.isPrimaryEntryPointCommand?.() === true;

  if (!slash && !entry) return false;

  await interaction.launchActivity();

  const payload = buildChessleInvitePayload();

  try {
    await interaction.followUp(payload);
  } catch (error) {
    console.error(
      '[Chessle] Interaction follow-up failed:',
      error?.message ?? error
    );

    // Fallback when interaction follow-ups are unavailable.
    try {
      if (typeof interaction.channel?.send === 'function') {
        await interaction.channel.send(payload);
      } else {
        console.error(
          '[Chessle] No writable channel for invitation'
        );
      }
    } catch (fallbackError) {
      console.error(
        '[Chessle] Invite delivery failed:',
        fallbackError?.message ?? fallbackError
      );
    }
  }

  return true;
}
