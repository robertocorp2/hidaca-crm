INSERT OR IGNORE INTO `role_permissions` (`role`, `module`, `action`, `allowed`) VALUES
  ('admin', 'ai', 'approve', 1),
  ('operator', 'ai', 'approve', 0),
  ('viewer', 'ai', 'approve', 0);
