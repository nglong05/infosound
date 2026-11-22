-- Extend the canonical selectable taxonomy; song assignments are separate user data.
INSERT INTO genres (id,name,aliases,is_selectable,sort_order)
VALUES ('bolero','Bolero',ARRAY['bolero','nhạc bolero','nhac bolero'],true,330);
