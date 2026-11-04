"""Create a coordinator locally; do not enable public coordinator registration."""
import getpass
from main import Base,engine,SessionLocal,User,hashing,uid
from sqlalchemy import select
Base.metadata.create_all(engine)
email=input('Coordinator email: ').strip().lower();name=input('Name: ').strip();password=getpass.getpass('Password (8+ characters): ')
if len(password)<8:raise SystemExit('Password too short')
with SessionLocal() as db:
 if db.scalar(select(User).where(User.email==email)):raise SystemExit('Email already exists')
 db.add(User(id=uid(),email=email,name=name,password=hashing.hash(password),role='coordinator'));db.commit()
print('Coordinator created')
