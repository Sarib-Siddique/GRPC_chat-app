SELECT u.nickname, m.content, m."createdAt"
FROM "Messages" m
JOIN "Users" u ON u.id = m."UserId"
ORDER BY m."createdAt" DESC
LIMIT 20;
