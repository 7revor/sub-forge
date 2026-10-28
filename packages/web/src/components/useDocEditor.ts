// 文档详情页的通用状态：加载 → 草稿 → 保存 / 删除；新建时 id 为 new，保存后跳转到真实 id。

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router';
import { useDeleteDoc, useDoc, useSaveDoc, type DocMap, type Kind } from '../hooks.ts';

export function useDocEditor<K extends Kind>(kind: K, empty: DocMap[K]) {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const doc = useDoc(kind, id);
  const save = useSaveDoc(kind);
  const del = useDeleteDoc(kind);
  const [draft, setDraft] = useState<DocMap[K] | undefined>(isNew ? empty : undefined);
  useEffect(() => { if (doc.data) setDraft(doc.data); }, [doc.data]);
  useEffect(() => { if (isNew) setDraft(empty); }, [isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(doc.data);
  const submit = (transform: (d: DocMap[K]) => Partial<DocMap[K]> = (d) => d) => {
    if (!draft) return;
    const body = transform(draft) as Partial<DocMap[K]> & { id?: string };
    if (isNew) delete body.id;
    save.mutate(body, { onSuccess: (item) => { if (isNew) navigate(`/${kind}/${(item as { id: string }).id}`, { replace: true }); } });
  };
  const remove = (name: string) => {
    if (!draft || !confirm(`删除「${name}」？`)) return;
    del.mutate((draft as { id: string }).id, { onSuccess: () => navigate(`/${kind}`) });
  };
  return { id, isNew, doc, draft, setDraft, dirty, save, submit, del, remove };
}
