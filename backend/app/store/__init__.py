from ..config import settings
from .base import Store


def make_store() -> Store:
    if settings.database_url:
        from .timescale import TimescaleStore
        return TimescaleStore(settings.database_url)
    from .memory import MemoryStore
    return MemoryStore()
