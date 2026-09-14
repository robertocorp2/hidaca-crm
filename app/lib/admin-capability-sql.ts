export function activeCapableAdministratorSql() {
  return `EXISTS (
    SELECT 1 FROM staff_users capable
    WHERE capable.id <> ?
      AND capable.active = 1
      AND capable.role = 'admin'
      AND CASE
        WHEN (SELECT uo.effect FROM user_permission_overrides uo
              WHERE uo.user_id = capable.id AND uo.module = 'usuarios'
                AND uo.action = 'view' LIMIT 1) = 'deny' THEN 0
        WHEN (SELECT uo.effect FROM user_permission_overrides uo
              WHERE uo.user_id = capable.id AND uo.module = 'usuarios'
                AND uo.action = 'view' LIMIT 1) = 'allow' THEN 1
        ELSE COALESCE((SELECT rp.allowed FROM role_permissions rp
                       WHERE rp.role = capable.role AND rp.module = 'usuarios'
                         AND rp.action = 'view' LIMIT 1), 1)
      END = 1
      AND CASE
        WHEN (SELECT uo.effect FROM user_permission_overrides uo
              WHERE uo.user_id = capable.id AND uo.module = 'usuarios'
                AND uo.action = 'administer' LIMIT 1) = 'deny' THEN 0
        WHEN (SELECT uo.effect FROM user_permission_overrides uo
              WHERE uo.user_id = capable.id AND uo.module = 'usuarios'
                AND uo.action = 'administer' LIMIT 1) = 'allow' THEN 1
        ELSE COALESCE((SELECT rp.allowed FROM role_permissions rp
                       WHERE rp.role = capable.role AND rp.module = 'usuarios'
                         AND rp.action = 'administer' LIMIT 1), 1)
      END = 1
  )`;
}
