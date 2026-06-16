-- Migración 002 — agregar columna offer_type a kits
ALTER TABLE public.kits
ADD COLUMN IF NOT EXISTS offer_type text NOT NULL DEFAULT 'producto_fisico'
CHECK (offer_type IN ('producto_fisico','infoproducto','producto_digital','servicio','saas'));
