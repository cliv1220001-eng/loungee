-- Seed admin accounts. Generated with scrypt hashes — NO plaintext here.
-- Safe to re-run: on conflict it refreshes the hash/role.
-- NOTE: euruuu has a PLACEHOLDER password (changeme-euruuu) — change it.

insert into users (username, pw_hash, role) values
  ('euruuu', 'scrypt$9b58569b9c86ee5b6e2ee2e8845c703f$b5053fbf499713d0678705ae15bedb618c0b5f2ce45371d59373dd40c8b8bb066efa737121fe7ff952f56c31f6c355c66045a4193920eb060e048c8d33964f91', 'owner'),
  ('kiela', 'scrypt$ec06fdda84f3b91f451bf4a0dda0367a$0fea8980f0f3114665872dc4d8efeab670cde0bec566afa8fcad1dbb87b1281a31fbeb46ef0ca4b063927a93996461447c76ac2acceae81f77b5d4c3d12f0c9b', 'owner'),
  ('namnam', 'scrypt$880d56630a951f0ea9e908eb8bd5481f$29910de465872b1ae7182958f4fb5fa6010ea966b4042b13ccf8490fbc14c1bbc3edb575761d0bf2ec89cd920b13adce59a68cbbb9c361935e3ca2affd4197d4', 'owner'),
  ('tonya', 'scrypt$07a5138c3cd4c1bcb533a8f0c88432f9$dcc0d9be9d97ec95fc63ab98e053615d98acffedb182ce3f53e191ebd6a363eb092ca5af8e099a15636e00495c9c4e51fa64073b61f18680d03082c469628148', 'admin'),
  ('ryla', 'scrypt$7782eeae713b9f4c32781f0997a5cccb$d432d35cc87f3800d83626a7dbb3a3acde071c7cc884cd0df0604bbcf33bb266db2826e35ad51c440dbf496d57da4b4ce947f89d61c09a6adbddd9b6ad9b68b7', 'admin'),
  ('mimasaur', 'scrypt$4ebdbd75ca3e0d21b17390b8b830a315$804b6c3cd29064fe374945458252bd5888946b89e08671edc2ba80c7998b2dff518bfb974a5c08c7723d7dd1d852ff1452384df4e690d3de0552a90bb5491776', 'admin'),
  ('cliv', 'scrypt$6809300aa0c7293f032b70c5230c7a28$d9801b60c71fe50b63513da929547919782c0f2f79567a5f52e5589b59882209e263b9f147ea8cc10d94905794f9a95843ee87beecb8c0c6ecb34875b2ca4d6e', 'owner'),
  ('belle', 'scrypt$0f7ee3fc9df0b00c9690314cc1260ad2$b1f9687ba18082afb325acf93e4ff61e4c917a4d13530cc5e5dda49dbc766c33fbceac7c4ac6acefd09e99bb601d8e1222fe94cb1003774ed90d9dfabebf909c', 'admin')
on conflict (username) do update set pw_hash = excluded.pw_hash, role = excluded.role;
