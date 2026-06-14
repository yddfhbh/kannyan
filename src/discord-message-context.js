export async function resolveReferencedMessageChain(message, options = {}) {
  const maxDepth = Math.max(1, Number(options.maxDepth) || 4);
  const referencedMessages = [];
  const seenMessageIds = new Set();
  let currentMessage = message;

  if (message?.id) {
    seenMessageIds.add(message.id);
  }

  for (let depth = 0; depth < maxDepth; depth += 1) {
    const referencedMessageId = currentMessage?.reference?.messageId;
    if (!referencedMessageId || typeof currentMessage.fetchReference !== 'function') {
      break;
    }

    if (seenMessageIds.has(referencedMessageId)) {
      break;
    }
    seenMessageIds.add(referencedMessageId);

    let referencedMessage;
    try {
      referencedMessage = await currentMessage.fetchReference();
    } catch (error) {
      options.onError?.(error, currentMessage);
      break;
    }

    if (!referencedMessage) {
      break;
    }

    if (referencedMessage.id) {
      if (
        referencedMessage.id !== referencedMessageId
        && seenMessageIds.has(referencedMessage.id)
      ) {
        break;
      }
      seenMessageIds.add(referencedMessage.id);
    }

    referencedMessages.push(referencedMessage);
    currentMessage = referencedMessage;
  }

  return referencedMessages;
}

export function getMessageChainAttachments(message, referencedMessages = []) {
  return [message, ...referencedMessages]
    .flatMap((targetMessage) => (
      targetMessage?.attachments
        ? [...targetMessage.attachments.values()]
        : []
    ));
}
