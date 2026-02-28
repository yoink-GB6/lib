-- 创建 articles 表
CREATE TABLE IF NOT EXISTS public.articles (
  id         bigserial PRIMARY KEY,
  title      text NOT NULL DEFAULT '',
  body       text NOT NULL DEFAULT '',
  author     text NOT NULL DEFAULT 'unknown',
  tags_json  text NOT NULL DEFAULT '[]',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 自动更新 updated_at
CREATE OR REPLACE FUNCTION update_articles_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER articles_updated_at
  BEFORE UPDATE ON public.articles
  FOR EACH ROW EXECUTE FUNCTION update_articles_updated_at();

-- RLS
ALTER TABLE public.articles ENABLE ROW LEVEL SECURITY;
CREATE POLICY "allow_select" ON public.articles FOR SELECT USING (true);
CREATE POLICY "allow_insert" ON public.articles FOR INSERT WITH CHECK (true);
CREATE POLICY "allow_update" ON public.articles FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "allow_delete" ON public.articles FOR DELETE USING (true);
