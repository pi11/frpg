"""Grant or revoke admin rights from the server shell.

    python -m app.services.admin grant <user id | email>
    python -m app.services.admin revoke <user id | email>
    python -m app.services.admin list

The user id is shown in the shelter settings and in the admin panel; an email works when the
account signs in by mail. Every change goes to admin_actions.
"""

import argparse
import asyncio
import sys
import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.admin import AdminAction
from app.models.auth import AuthIdentity, User


async def find_user(session: AsyncSession, who: str) -> User | None:
    """A user by id, or by an email they sign in with."""
    try:
        return await session.get(User, uuid.UUID(who))
    except ValueError:
        pass
    identity = await session.scalar(select(AuthIdentity).where(
        AuthIdentity.provider == "email", AuthIdentity.subject == who.strip().lower(),
    ))
    return None if identity is None else await session.get(User, identity.user_id)


async def set_admin(session: AsyncSession, who: str, admin: bool) -> User | None:
    user = await find_user(session, who)
    if user is None:
        return None
    if user.is_admin != admin:
        user.is_admin = admin
        session.add(AdminAction(
            admin_id=None, user_id=user.id, action="grant_admin" if admin else "revoke_admin",
            details={"by": "shell"},
        ))
        await session.commit()
    return user


async def list_admins(session: AsyncSession) -> list[User]:
    return list((await session.scalars(
        select(User).where(User.is_admin.is_(True)).order_by(User.created_at)
    )).all())


async def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="python -m app.services.admin")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("grant", "revoke"):
        commands.add_parser(name).add_argument("user", help="user id or sign-in email")
    commands.add_parser("list")
    args = parser.parse_args(argv)

    from app.db import SessionFactory, engine

    try:
        async with SessionFactory() as session:
            if args.command == "list":
                for user in await list_admins(session):
                    print(user.id)
                return 0
            changed = await set_admin(session, args.user, args.command == "grant")
            if changed is None:
                print(f"Пользователь не найден: {args.user}", file=sys.stderr)
                return 1
            print(f"{changed.id}: {'админ' if changed.is_admin else 'не админ'}")
            return 0
    finally:
        await engine.dispose()


if __name__ == "__main__":
    sys.exit(asyncio.run(main(sys.argv[1:])))
