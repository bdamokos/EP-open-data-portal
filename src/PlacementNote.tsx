import type {ReactNode} from 'react';
import {UiMessage, useUiI18n} from './UiI18nReact';

/** The one note style for a placed amendment; it sits above the wording, in the interface language. */
export function PlacementNote({id, values}: {id: string; values?: Readonly<Record<string, ReactNode>>}) {
  const ui = useUiI18n();
  return <p className="document-context-notice" lang={ui.language}><UiMessage id={id} values={values}/></p>;
}
