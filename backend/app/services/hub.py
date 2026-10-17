"""Tiny WebSocket pub/sub. Channels: "nurse", "patient:<id>", "family:<person id>"."""
import json
import logging
from collections import defaultdict

from fastapi import WebSocket

log = logging.getLogger(__name__)


class Hub:
    def __init__(self):
        self.channels: dict[str, set[WebSocket]] = defaultdict(set)

    def subscribe(self, channel: str, ws: WebSocket):
        self.channels[channel].add(ws)

    def unsubscribe(self, ws: WebSocket):
        for subs in self.channels.values():
            subs.discard(ws)

    async def publish(self, channel: str, message: dict):
        data = json.dumps(message, default=str)
        for ws in list(self.channels.get(channel, ())):
            try:
                await ws.send_text(data)
            except Exception:  # client went away mid-send
                log.debug("dropping dead websocket on %s", channel)
                self.channels[channel].discard(ws)
