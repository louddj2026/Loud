/** Decoded loop transport. Audio and the displayed position use one AudioContext clock. */
export class BufferedDeckTransport {
 private source:AudioBufferSourceNode|null=null;
 private anchor=0; private position=0; private speed=1; private stopped=true;
 private looping=false; private start=0; private end=0;
 readonly media:HTMLAudioElement;
 private context:AudioContext;private buffer:AudioBuffer;private outputs:AudioNode[];private ended:()=>void;
 constructor(context:AudioContext, buffer:AudioBuffer, native:HTMLAudioElement, outputs:AudioNode[], ended:()=>void){
  this.context=context;this.buffer=buffer;this.outputs=outputs;this.ended=ended;
  this.position=native.currentTime;this.speed=native.playbackRate;
  this.media=new Proxy(native,{get:(_target,key)=>{
   if(key==='currentTime')return this.currentTime;
   if(key==='playbackRate')return this.playbackRate;
   if(key==='paused')return this.paused;
   if(key==='duration')return buffer.duration;
   if(key==='seeking'||key==='ended')return key==='ended'&&this.stopped&&this.position>=buffer.duration;
   if(key==='readyState')return 4;
   if(key==='play')return ()=>this.play();
   if(key==='pause')return ()=>this.pause();
   const value=Reflect.get(native,key,native);return typeof value==='function'?value.bind(native):value;
  },set:(_target,key,value)=>{
   if(key==='currentTime'){this.currentTime=Number(value);return true;}
   if(key==='playbackRate'){this.playbackRate=Number(value);return true;}
   return Reflect.set(native,key,value,native);
  }});
 }
 private bounded(time:number){
  if(this.looping&&time>=this.end)return this.start+((time-this.start)%(this.end-this.start)+(this.end-this.start))%(this.end-this.start);
  return Math.max(0,Math.min(this.buffer.duration,time));
 }
 get currentTime(){return this.bounded(this.position+(this.stopped?0:Math.max(0,this.context.currentTime-this.anchor)*this.speed));}
 set currentTime(time:number){const running=!this.stopped;this.stopSource();this.position=this.bounded(time);this.stopped=true;if(running)void this.play();}
 get clock(){const raw=this.position+(this.stopped?0:Math.max(0,this.context.currentTime-this.anchor)*this.speed);return {contextTime:this.context.currentTime,anchor:this.anchor,time:this.currentTime,rate:this.speed,cycle:this.looping?Math.max(0,Math.floor((raw-this.start)/(this.end-this.start))):0,start:this.start,end:this.end};}
 get paused(){return this.stopped;}
 get playbackRate(){return this.speed;}
 set playbackRate(value:number){if(!Number.isFinite(value)||value<=0)return;this.position=this.currentTime;this.anchor=this.context.currentTime;this.speed=value;if(this.source)this.source.playbackRate.setValueAtTime(value,this.anchor);}
 configureLoop(enabled:boolean,start:number|null,end:number|null){
  this.position=this.currentTime;this.anchor=this.context.currentTime;
  this.looping=enabled&&start!==null&&end!==null&&end>start;this.start=start??0;this.end=end??this.buffer.duration;
  if(this.source){this.source.loop=this.looping;this.source.loopStart=this.start;this.source.loopEnd=this.end;}
 }
 async play(when=this.context.currentTime){
  if(!this.stopped)return;
  const source=this.context.createBufferSource();source.buffer=this.buffer;source.loop=this.looping;source.loopStart=this.start;source.loopEnd=this.end;source.playbackRate.value=this.speed;
  for(const output of this.outputs)source.connect(output);
  this.anchor=Math.max(when,this.context.currentTime);this.position=this.bounded(this.position);this.stopped=false;this.source=source;
  source.onended=()=>{if(this.source!==source)return;this.position=this.buffer.duration;this.stopped=true;this.source=null;source.disconnect();this.ended();};
  source.start(this.anchor,this.position);
 }
 pause(){this.position=this.currentTime;this.stopped=true;this.stopSource();}
 private stopSource(){const old=this.source;this.source=null;if(old){old.onended=null;try{old.stop();}catch{}old.disconnect();}}
 dispose(){this.pause();}
}
