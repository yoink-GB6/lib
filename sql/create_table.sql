-- 在 Supabase SQL Editor 执行此文件
-- 为 general 站新建独立的指令集表

CREATE TABLE IF NOT EXISTS general_library_items (
  LIKE library_items INCLUDING ALL
);

-- 重建序列（LIKE 不会复制序列的所有权，需要手动设一下）
ALTER TABLE general_library_items
  ALTER COLUMN id SET DEFAULT nextval('library_items_id_seq'::regclass);
-- 如果上面报错（序列名不同），可以改用：
-- ALTER TABLE general_library_items ALTER COLUMN id SET DEFAULT gen_random_uuid();
-- 或者直接新建序列：
-- CREATE SEQUENCE general_library_items_id_seq;
-- ALTER TABLE general_library_items ALTER COLUMN id SET DEFAULT nextval('general_library_items_id_seq');

-- 开启 Row Level Security
ALTER TABLE general_library_items ENABLE ROW LEVEL SECURITY;

-- 允许所有操作（和主站策略一致）
CREATE POLICY "Enable all" ON general_library_items FOR ALL USING (true);
