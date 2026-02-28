-- 1. 创建 gallery_items 表
CREATE TABLE IF NOT EXISTS gallery_items (
  id            bigserial PRIMARY KEY,
  title         text,
  description   text,
  author        text NOT NULL DEFAULT 'unknown',
  tags_json     text NOT NULL DEFAULT '[]',
  image_url     text NOT NULL,
  storage_path  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER gallery_items_updated_at
  BEFORE UPDATE ON gallery_items
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();

-- RLS
ALTER TABLE gallery_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Enable all" ON gallery_items FOR ALL USING (true);

-- 2. 创建 storage bucket（在 Supabase Dashboard → Storage 手动创建名为 gallery 的 public bucket）
-- 或执行：
-- INSERT INTO storage.buckets (id, name, public) VALUES ('gallery', 'gallery', true);
