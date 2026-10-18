import {Component,Fragment,useEffect,useId,useRef,useState,type ReactNode} from 'react';
import {interfaceLanguages} from './interfaceCopy';
import {interfaceTerm} from './terms.mjs';
import './recovery.css';

function urlLanguage() {
  const language=new URLSearchParams(location.search).get('lang')||'en';
  return interfaceLanguages.includes(language)?language:'en';
}

function Recovery({language=urlLanguage(),navigation,retry}:{language?:string;navigation?:ReactNode;retry:()=>void}) {
  const heading=useRef<HTMLHeadingElement>(null),id=useId();
  const title=interfaceTerm('view-error',language),help=interfaceTerm('view-error-help',language);
  useEffect(()=>{heading.current?.focus({preventScroll:true});},[]);
  return <main className="explorer explorer-recovery" lang={title.language}>
    {navigation}
    <section className="explorer-notice" role="alert" aria-labelledby={id}>
      <h1 id={id} ref={heading} tabIndex={-1}>{title.text}</h1>
      <p lang={help.language}>{help.text}</p>
      <div className="explorer-recovery-actions">
        <button onClick={retry}>{interfaceTerm('try-again',language).text}</button>
        <a href={'?lang='+language}>{interfaceTerm('go-home',language).text}</a>
        <button onClick={()=>location.reload()}>{interfaceTerm('reload-page',language).text}</button>
      </div>
    </section>
  </main>;
}

type Props={children:ReactNode;language?:string;resetKey:string;navigation?:ReactNode;onRetry?:()=>void};
type State={failed:boolean;resetKey:string;attempt:number};

// Render/lifecycle failures (including rejected lazy imports) reach this boundary.
// Event handlers and asynchronous data requests retain their own error handling.
export class ErrorBoundary extends Component<Props,State> {
  state:State={failed:false,resetKey:this.props.resetKey,attempt:0};
  static getDerivedStateFromError(){return {failed:true};}
  static getDerivedStateFromProps(props:Props,state:State) {
    return props.resetKey!==state.resetKey?{failed:false,resetKey:props.resetKey,attempt:0}:null;
  }
  render() {
    if(this.state.failed)return <Recovery language={this.props.language} navigation={this.props.navigation} retry={()=>{
      this.props.onRetry?.();
      this.setState(state=>({failed:false,attempt:state.attempt+1}));
    }}/>;
    return <Fragment key={this.state.attempt}>{this.props.children}</Fragment>;
  }
}

export function RootBoundary({children}:{children:ReactNode}) {
  const [navigation,setNavigation]=useState(0);
  useEffect(()=>{
    const restore=()=>setNavigation(value=>value+1);
    window.addEventListener('popstate',restore);
    return ()=>window.removeEventListener('popstate',restore);
  },[]);
  return <ErrorBoundary resetKey={String(navigation)}>{children}</ErrorBoundary>;
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

export function ViewLoading({language}:{language:string}) {
  const term=interfaceTerm('loading-view',language);
  return <main className="explorer explorer-recovery" lang={term.language} data-view-loading="true" aria-busy="true">
    <p role="status">{term.text}</p>
    <a href={'?lang='+language}>{interfaceTerm('go-home',language).text}</a>
  </main>;
}
