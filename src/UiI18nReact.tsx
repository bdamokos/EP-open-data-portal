import {defaultUi} from './uiDefault.mjs';
import {createContext, Fragment, useContext, useMemo} from 'react';
import type {ReactNode} from 'react';
import type {UiFormatter, UiI18n} from './uiI18n.mjs';

const UiI18nContext = createContext<UiFormatter>(defaultUi);

/** Scope to an app/request/subtree. Changing language creates a new formatter. */
export function UiI18nProvider({i18n, language, children}: {
  i18n: UiI18n;
  language?: string | null;
  children: ReactNode;
}) {
  const formatter = useMemo(() => i18n.forLocale(language), [i18n, language]);
  return <UiI18nContext.Provider value={formatter}>{children}</UiI18nContext.Provider>;
}

export function useUiI18n(): UiFormatter {
  const formatter = useContext(UiI18nContext);
  return formatter;
}

/** Named node slots can move with the translation; no markup is read from messages. */
export function UiMessage({id, values, counts}: {
  id: string;
  values?: Readonly<Record<string, ReactNode>>;
  counts?: Readonly<Record<string, number>>;
}) {
  const formatter = useUiI18n();
  return <>{formatter.rich<ReactNode>(id, values && Object.fromEntries(Object.entries(values).map(([key,value])=>[key,(value===undefined) ? null : value])), counts).map((part, index) => <Fragment key={index}>{part}</Fragment>)}</>;
}

/** Announce a whole message around visible, caller-owned source nodes. */
export function UiAnnotatedMessage({id, values, srClassName}: {
  id:string; values:Readonly<Record<string, ReactNode>>; srClassName:string;
}) {
  const formatter=useUiI18n();
  return <>{formatter.rich<ReactNode>(id,values).map((part,index)=><Fragment key={index}>{(typeof part==='string') ? <span className={srClassName} lang={formatter.language}>{part}</span> : part}</Fragment>)}</>;
}
