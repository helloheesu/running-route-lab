// Average linkage over every cross-cluster pair, with a diameter guard.
// Scores and representatives are deliberately absent from this module.
class PairQueue {
  items=[];
  before(a,b){return a.score>b.score||(a.score===b.score&&(a.a<b.a||(a.a===b.a&&a.b<b.b)));}
  push(value){
    const q=this.items;let i=q.length;q.push(value);
    while(i){const p=(i-1)>>1;if(!this.before(value,q[p]))break;q[i]=q[p];i=p;}q[i]=value;
  }
  pop(){
    const q=this.items;if(!q.length)return null;const first=q[0],last=q.pop();
    if(q.length){let i=0;while(i*2+1<q.length){let c=i*2+1;if(c+1<q.length&&this.before(q[c+1],q[c]))c++;if(!this.before(q[c],last))break;q[i]=q[c];i=c;}q[i]=last;}
    return first;
  }
}
export function clusterBySimilarity(items,similarity,{meanThreshold=.65,pairFloor=.50}={}) {
  const sorted=[...items].sort((a,b)=>a.id.localeCompare(b.id)),n=sorted.length;
  const mean=Array.from({length:n},()=>new Float64Array(n)),minimum=mean.map(r=>r.slice());
  const groups=sorted.map((item,i)=>({indices:[i],active:true,revision:0,pairSum:0,minSimilarity:1,lastMergeSimilarity:1})),queue=new PairQueue();
  const eligible=(a,b)=>mean[a][b]+1e-9>=meanThreshold&&minimum[a][b]+1e-9>=pairFloor;
  const enqueue=(i,j)=>{const a=Math.min(i,j),b=Math.max(i,j);if(eligible(a,b))queue.push({a,b,score:mean[a][b],va:groups[a].revision,vb:groups[b].revision});};
  for(let i=0;i<n;i++)for(let j=0;j<i;j++){
    const value=similarity(sorted[i],sorted[j]);
    if(!Number.isFinite(value)||value<0||value>1+1e-8)throw new Error('Invalid route similarity');
    mean[i][j]=mean[j][i]=minimum[i][j]=minimum[j][i]=Math.min(1,value);enqueue(i,j);
  }
  let pair;
  while((pair=queue.pop())) {
    const {a,b,va,vb}=pair,A=groups[a],B=groups[b];
    if(!A.active||!B.active||A.revision!==va||B.revision!==vb)continue;
    const na=A.indices.length,nb=B.indices.length;
    A.pairSum+=B.pairSum+mean[a][b]*na*nb;
    A.minSimilarity=Math.min(A.minSimilarity,B.minSimilarity,minimum[a][b]);
    A.lastMergeSimilarity=mean[a][b];
    for(let k=0;k<n;k++)if(k!==a&&k!==b&&groups[k].active){
      mean[a][k]=mean[k][a]=(mean[a][k]*na+mean[b][k]*nb)/(na+nb);
      minimum[a][k]=minimum[k][a]=Math.min(minimum[a][k],minimum[b][k]);
    }
    A.indices.push(...B.indices);A.revision++;B.active=false;B.revision++;
    for(let k=0;k<n;k++)if(k!==a&&groups[k].active)enqueue(a,k);
  }
  return groups.filter(g=>g.active).map(g=>{
    const count=g.indices.length,pairCount=count*(count-1)/2;
    return {members:g.indices.sort((a,b)=>a-b).map(i=>sorted[i]),clustering:{method:'guarded-average-linkage',metric:'physical-traversal-dice',meanThreshold,pairFloor,pairCount,meanSimilarity:pairCount?g.pairSum/pairCount:1,minSimilarity:g.minSimilarity,lastMergeSimilarity:g.lastMergeSimilarity}};
  });
}
