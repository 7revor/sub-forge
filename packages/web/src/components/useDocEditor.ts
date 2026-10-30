// 文档详情页的通用状态：加载 → 草稿 → 保存 / 删除；新建时 id 为 new，保存后跳转到真实 id。

import { useEffect, useRef, useState } from 'react';
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
  const previous=useRef<DocMap[K]|undefined>(undefined);
  useEffect(()=>{if(doc.data){const before=previous.current;previous.current=doc.data;setDraft(current=>!current||current.id!==doc.data!.id||JSON.stringify(current)===JSON.stringify(before)?doc.data:current);}},[doc.data]);
  useEffect(() => { if (isNew) setDraft(empty); }, [isNew]); // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = isNew || JSON.stringify(draft) !== JSON.stringify(doc.data);
  const submit = (transform: (d: DocMap[K]) => Partial<DocMap[K]> = (d) => d) => {
    if (!draft) return;
    const body = transform(draft) as Partial<DocMap[K]> & { id?: string };
    if (isNew) delete body.id;
    save.mutate(body, { onSuccess: (item) => { setDraft(item); if (isNew) navigate(`/${kind}/${(item as { id: string }).id}`, { replace: true }); } });
  };
  /** 由 DetailShell 的确认对话框调用 */
  const remove = () => {
    if (!draft) return;
    del.mutate((draft as { id: string }).id, { onSuccess: () => navigate(`/${kind}`) });
  };
  return { id, isNew, doc, draft, setDraft, dirty, save, submit, del, remove };
}
