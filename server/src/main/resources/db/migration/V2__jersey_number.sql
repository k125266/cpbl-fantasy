-- 背號：球員頭像以背號 + 球隊色圈呈現（不使用球員照片，規則書 10.2）
alter table player add column jersey_number varchar(4);
