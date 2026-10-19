"""Database access for organization voice profiles.

Each row is one named TTS configuration (provider, key, model, voice) that an
organization can attach to its agents. Every read and write is scoped by
``organization_id``: tenant isolation is enforced here, not by the callers.
"""

from typing import Any, Dict, List, Optional

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.future import select

from api.db.base_client import BaseDBClient
from api.db.models import VoiceProfileModel


class VoiceProfileConflictError(Exception):
    """Raised when a voice profile violates a DB constraint (duplicate name or
    a second default profile in the same organization)."""


class VoiceProfileClient(BaseDBClient):
    async def list_voice_profiles(
        self, organization_id: int
    ) -> List[VoiceProfileModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(VoiceProfileModel)
                .where(VoiceProfileModel.organization_id == organization_id)
                .order_by(VoiceProfileModel.name)
            )
            return list(result.scalars().all())

    async def get_voice_profile(
        self, profile_id: int, organization_id: int
    ) -> Optional[VoiceProfileModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(VoiceProfileModel).where(
                    VoiceProfileModel.id == profile_id,
                    VoiceProfileModel.organization_id == organization_id,
                )
            )
            return result.scalars().first()

    async def get_default_voice_profile(
        self, organization_id: int
    ) -> Optional[VoiceProfileModel]:
        async with self.async_session() as session:
            result = await session.execute(
                select(VoiceProfileModel).where(
                    VoiceProfileModel.organization_id == organization_id,
                    VoiceProfileModel.is_default.is_(True),
                )
            )
            return result.scalars().first()

    async def create_voice_profile(
        self,
        organization_id: int,
        name: str,
        tts: Dict[str, Any],
        is_default: bool = False,
    ) -> VoiceProfileModel:
        async with self.async_session() as session:
            if is_default:
                await self._clear_default(session, organization_id)
            row = VoiceProfileModel(
                organization_id=organization_id,
                name=name,
                tts=tts,
                is_default=is_default,
            )
            session.add(row)
            try:
                await session.commit()
            except IntegrityError as e:
                await session.rollback()
                raise VoiceProfileConflictError(str(e)) from e
            await session.refresh(row)
            return row

    async def update_voice_profile(
        self,
        profile_id: int,
        organization_id: int,
        name: Optional[str] = None,
        tts: Optional[Dict[str, Any]] = None,
        is_default: Optional[bool] = None,
    ) -> Optional[VoiceProfileModel]:
        async with self.async_session() as session:
            row = await session.get(VoiceProfileModel, profile_id)
            if row is None or row.organization_id != organization_id:
                return None

            if name is not None:
                row.name = name
            if tts is not None:
                row.tts = tts
            if is_default is True:
                await self._clear_default(session, organization_id)
                row.is_default = True
            elif is_default is False:
                row.is_default = False

            try:
                await session.commit()
            except IntegrityError as e:
                await session.rollback()
                raise VoiceProfileConflictError(str(e)) from e
            await session.refresh(row)
            return row

    async def delete_voice_profile(self, profile_id: int, organization_id: int) -> bool:
        async with self.async_session() as session:
            row = await session.get(VoiceProfileModel, profile_id)
            if row is None or row.organization_id != organization_id:
                return False
            await session.delete(row)
            await session.commit()
            return True

    @staticmethod
    async def _clear_default(session, organization_id: int) -> None:
        await session.execute(
            update(VoiceProfileModel)
            .where(
                VoiceProfileModel.organization_id == organization_id,
                VoiceProfileModel.is_default.is_(True),
            )
            .values(is_default=False)
        )