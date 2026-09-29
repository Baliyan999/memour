
-- Per-event QR PDF customization. Stored as a single jsonb blob so
-- adding new options (gradient stops, dot density, etc.) doesn't
-- require schema migrations every time.
--
-- Shape:
-- {
--   "style": "rounded",         -- preset id or 'custom'
--   "layout": "2x2",
--   "fg": "#3a2010",            -- foreground hex (custom mode)
--   "bg": "#fbf6f0",            -- background hex
--   "dot": "rounded",           -- when style='custom'
--   "corner": "rounded",
--   "gradient": {               -- optional
--     "from": "#9c7440",
--     "to":   "#b85c5c",
--     "angle": 45
--   },
--   "logo_path": "events/{id}/logo.png"   -- relative to 'branding' bucket
-- }
alter table public.events
  add column if not exists qr_settings jsonb not null default '{}'::jsonb;
