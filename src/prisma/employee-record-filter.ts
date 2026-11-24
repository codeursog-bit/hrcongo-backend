import { Prisma } from '@prisma/client';

const models=new Map(Prisma.dmmf.datamodel.models.map(model=>[model.name,model]));
const visible=(where:any={})=>Object.prototype.hasOwnProperty.call(where,'recordDeletedAt')?where:{...where,recordDeletedAt:null};

/** Les relations financières vers une fiche restent lisibles ; les listes de fiches la masquent. */
function filterSelections(modelName:string,args:any) {
  const model=models.get(modelName);if(!model||!args)return;
  for(const selection of [args.select,args.include]) {
    if(!selection)continue;
    for(const field of model.fields.filter(field=>field.kind==='object')) {
      let selected=selection[field.name];if(!selected)continue;
      if(field.type==='Employee'&&field.isList) {
        selected=selected===true?{}:{...selected};selected.where=visible(selected.where);selection[field.name]=selected;
      }
      if(typeof selected==='object')filterSelections(field.type,selected);
    }
    if(selection._count===true)selection._count={select:Object.fromEntries(model.fields.filter(field=>field.kind==='object'&&field.isList).map(field=>[field.name,field.type==='Employee'?{where:visible()}:true]))};
    const counts=selection._count?.select;
    if(counts)for(const field of model.fields.filter(f=>f.type==='Employee'&&f.isList)) {
      if(counts[field.name])counts[field.name]={...(counts[field.name]===true?{}:counts[field.name]),where:visible(counts[field.name]?.where)};
    }
  }
}

export const employeeRecordFilter:Prisma.Middleware=async(params,next)=>{
  if(params.model==='Employee'&&['findMany','findFirst','findFirstOrThrow','findUnique','findUniqueOrThrow','count','aggregate','groupBy','update','updateMany','delete','deleteMany'].includes(params.action)) {
    params.args??={};params.args.where=visible(params.args.where);
  }
  if(params.model)filterSelections(params.model,params.args);
  return next(params);
};
