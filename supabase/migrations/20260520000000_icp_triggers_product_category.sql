-- Add product_category to icp_triggers.
-- Captures the new Notion "Product Category" multi-select property,
-- which covers Medical Device, SaMD, Health IT, and sub-clinical tools.
-- device_category (free-form FDA product code / advisory panel text) is preserved as-is.

alter table public.icp_triggers
  add column if not exists product_category text[];
