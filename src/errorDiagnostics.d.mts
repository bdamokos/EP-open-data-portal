export function diagnosticRequest(input:unknown):string|null;
export function reportUiError(error:unknown,context?:{request?:string;code?:string}):void;
export function installErrorDiagnostics(target:Window & typeof globalThis,endpoint:string):void;
