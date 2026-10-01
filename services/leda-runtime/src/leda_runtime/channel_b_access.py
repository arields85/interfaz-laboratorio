"""Admin-side view of the Channel B access list: list the chats and decide on their requests.

This is HMI configuration (who may use the Telegram assistant). It never reaches the plant.
"""

from __future__ import annotations

import logging
from typing import Any, Callable

# Only the exception type is ever logged, never a chat id, name or message text.
_logger = logging.getLogger(__name__)

# Admin route action -> resulting chat status.
ACCESS_DECISIONS = {"approve": "approved", "reject": "rejected", "revoke": "revoked"}
# Pending requests first, then approved chats, then rejected and revoked ones.
_STATUS_ORDER = {"pending": 0, "approved": 1, "rejected": 2, "revoked": 2}
ACCESS_CHAT_FIELDS = ("chatId", "status", "displayName", "username", "requestedAt", "decidedAt")


class ChannelBAccessUnavailable(RuntimeError):
    """Channel B has no running bot identity yet, so there is no access list to manage."""


def project_access_chat(chat: dict[str, Any]) -> dict[str, Any]:
    """Copy only the frozen admin contract fields out of a state chat record."""
    return {field: chat[field] for field in ACCESS_CHAT_FIELDS}


class ChannelBAccess:
    def __init__(self, bot_source: Callable[[], Any], audit_log=None):
        self._bot_source = bot_source
        self._audit_log = audit_log

    def _bot(self):
        bot = self._bot_source()
        bot_id = getattr(bot, "bot_id", None)
        if bot is None or isinstance(bot_id, bool) or not isinstance(bot_id, int) or getattr(bot, "state_store", None) is None:
            raise ChannelBAccessUnavailable("CHANNEL_B_ACCESS_UNAVAILABLE")
        return bot

    def list_chats(self) -> list[dict[str, Any]]:
        bot = self._bot()
        chats = [project_access_chat(chat) for chat in bot.state_store.list_chats(bot.bot_id)]
        return sorted(chats, key=lambda chat: (_STATUS_ORDER[chat["status"]], chat["requestedAt"], chat["chatId"]))

    def decide(self, chat_id: int, action: str) -> tuple[dict[str, Any], bool]:
        """Apply one admin decision; returns the updated chat and whether the approval notice was sent.

        Raises ``TelegramChatNotFound`` / ``TelegramInvalidTransition`` (nothing is written) or
        ``ChannelBAccessUnavailable``. A failing audit write or approval notice never undoes the decision.
        """
        bot = self._bot()
        status = ACCESS_DECISIONS[action]
        chat = project_access_chat(bot.state_store.apply_decision(bot.bot_id, chat_id, status))
        self._audit(status, bot.bot_id, chat_id)
        notice_sent = self._send_approval_notice(bot, chat_id) if status == "approved" else False
        return chat, notice_sent

    def _audit(self, event: str, bot_id: int, chat_id: int) -> None:
        if self._audit_log is None:
            return
        try:
            self._audit_log.record(event, bot_id, chat_id, "admin")
        except Exception as error:
            _logger.warning("Leda Channel B admission audit failed: reason=%s", type(error).__name__)

    @staticmethod
    def _send_approval_notice(bot, chat_id: int) -> bool:
        """Best effort, from the HTTP thread: a Telegram or bot failure leaves the approval in place."""
        try:
            return bool(bot.send_approval_notice(chat_id))
        except Exception as error:
            _logger.warning("Leda Channel B approval notice not sent: reason=%s", type(error).__name__)
            return False
