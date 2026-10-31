import {useUiI18n} from './UiI18nReact';
import {Component,Fragment,useEffect,useId,useRef,useState,useSyncExternalStore,type ReactNode} from 'react';
import {interfaceLanguages} from './interfaceCopy';
import {interfaceTerm} from './terms.mjs';
import {apiVersionMismatch,subscribeApiVersionMismatch} from './apiVersionMismatch.mjs';
import {LazyViewError} from './lazyView';
import './recovery.css';

function urlLanguage() {
  const language=new URLSearchParams(location.search).get('lang')||'en';
  return interfaceLanguages.includes(language) ? language : 'en';
}

function Recovery({language=urlLanguage(),navigation,retry}:{language?:string;navigation?:ReactNode;retry?:()=>void}) {
  const heading=useRef<HTMLHeadingElement>(null),id=useId();
  const title=interfaceTerm('view-error',language),help=interfaceTerm(retry ? 'view-error-help' : 'view-reload-help',language);
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[]);
  return <main className="explorer explorer-recovery" lang={title.language}>
    {navigation}
    <section className="explorer-notice" role="alert" aria-labelledby={id}>
      <h1 id={id} ref={heading} tabIndex={-1}>{title.text}</h1>
      <p lang={help.language}>{help.text}</p>
      <div className="explorer-recovery-actions">
        <button onClick={retry||(()=>location.reload())}>{interfaceTerm(retry ? 'try-again' : 'reload-page',language).text}</button>
        <a href={'?lang='+language}>{interfaceTerm('go-home',language).text}</a>
        {retry&&<button onClick={()=>location.reload()}>{interfaceTerm('reload-page',language).text}</button>}
      </div>
    </section>
  </main>;
}

type Props={children:ReactNode;language?:string;resetKey:string;navigation?:ReactNode;onRetry?:()=>void};
type State={failed:boolean;reloadRequired:boolean;resetKey:string;attempt:number};

// Render/lifecycle failures (including rejected lazy imports) reach this boundary.
// Event handlers and asynchronous data requests retain their own error handling.
export class ErrorBoundary extends Component<Props,State> {
  state:State={failed:false,reloadRequired:false,resetKey:this.props.resetKey,attempt:0};
  static getDerivedStateFromError(error:unknown){return {failed:true,reloadRequired:error instanceof LazyViewError};}
  static getDerivedStateFromProps(props:Props,state:State) {
    return (props.resetKey!==state.resetKey) ? ({failed:false,reloadRequired:false,resetKey:props.resetKey,attempt:0}) : null;
  }
  render() {
    if(this.state.failed)return <Recovery language={this.props.language} navigation={this.props.navigation} retry={this.state.reloadRequired ? undefined : (()=>{
      this.props.onRetry?.();
      this.setState(state=>({failed:false,attempt:state.attempt+1}));
    })}/>;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

export function RootBoundary({children}:{children:ReactNode}) {
  const mismatch=useSyncExternalStore(subscribeApiVersionMismatch,apiVersionMismatch);
  const [navigation,setNavigation]=useState(0);
  useEffect(()=>{
    const restore=()=>setNavigation(value=>value+1);
    window.addEventListener('popstate',restore);
    return ()=>window.removeEventListener('popstate',restore);
  },[]);
  return mismatch ? <ApiVersionRecovery/> : <ErrorBoundary resetKey={String(navigation)}>{children}</ErrorBoundary>;
}

function ApiVersionRecovery() {
  const heading=useRef<HTMLHeadingElement>(null),id=useId(),language=urlLanguage();
  const title=interfaceTerm('new-version',language),reload=interfaceTerm('reload-page',language);
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[]);
  return <main className="explorer explorer-recovery" lang={title.language}>
    <section className="explorer-notice" role="alert" aria-labelledby={id}>
      <h1 id={id} ref={heading} tabIndex={-1}>{title.text}</h1>
      <div className="explorer-recovery-actions"><button lang={reload.language} onClick={()=>location.reload()}>{reload.text}</button></div>
    </section>
  </main>;
}

// Evaluate view JSX inside the boundary, including inline member/directory maps.
export function ViewContent({render,onReady}:{render:()=>ReactNode;onReady:()=>void}) {
  useEffect(()=>{
    let active=true;
    queueMicrotask(()=>{if(active)onReady();});
    return ()=>{active=false;};
  });
  return render();
}

export function ViewLoading({language,title,embedded=false}:{language:string;title?:string;embedded?:boolean}) {
  const ui = useUiI18n();
  const term=interfaceTerm('loading-view',language);
  if(embedded)return <section className="view-loading" data-view-loading="true" aria-busy="true">
    {title&&<div className="insight-intro" lang={ui.language}><h1>{title}</h1></div>}
    <p role="status" lang={term.language}>{term.text}</p>
    <div className="view-loading-placeholders" aria-hidden="true"><span/><span/><span/></div>
  </section>;
  return <main className="explorer explorer-recovery" lang={term.language} data-view-loading="true" aria-busy="true">
    <p role="status">{term.text}</p>
    <a href={'?lang='+language}>{interfaceTerm('go-home',language).text}</a>
  </main>;
}
