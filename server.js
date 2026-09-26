import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import {fileURLToPath} from "url";
const __dirname=path.dirname(fileURLToPath(import.meta.url));
const app=express(), PORT=process.env.PORT||3000, DB=path.join(__dirname,"data.json");
app.use(express.json({limit:"2mb"})); app.use(express.static(path.join(__dirname,"public")));
const seed={
 companies:[{id:"c1",name:"شركة النخبة",lat:24.7136,lng:46.6753,radius:150,timezone:"Asia/Riyadh"}],
 branches:[{id:"b1",companyId:"c1",name:"المقر الرئيسي",lat:24.7136,lng:46.6753,radius:150}],
 users:[
  {id:"u1",companyId:"c1",branchId:"b1",name:"مدير النظام",email:"admin@example.com",password:"Admin@123",role:"owner",active:true,deviceId:null},
  {id:"u2",companyId:"c1",branchId:"b1",name:"أحمد محمد",email:"ahmed@example.com",password:"123456",role:"employee",active:true,deviceId:null},
  {id:"u3",companyId:"c1",branchId:"b1",name:"محمد علي",email:"mohamed@example.com",password:"123456",role:"employee",active:true,deviceId:null}
 ],
 schedules:[{id:"s1",companyId:"c1",name:"الدوام الأساسي",start:"09:00",end:"17:00",grace:15,days:[0,1,2,3,4]}],
 leaves:[], holidays:[], attendance:[], audit:[]
};
function load(){if(!fs.existsSync(DB)){fs.writeFileSync(DB,JSON.stringify(seed,null,2));return structuredClone(seed)} return JSON.parse(fs.readFileSync(DB,"utf8"))}
let db=load(); const save=()=>fs.writeFileSync(DB,JSON.stringify(db,null,2));
const id=()=>crypto.randomUUID();
function hav(a,b,c,d){const R=6371000,r=Math.PI/180,x=(c-a)*r,y=(d-b)*r,h=Math.sin(x/2)**2+Math.cos(a*r)*Math.cos(c*r)*Math.sin(y/2)**2;return 2*R*Math.asin(Math.sqrt(h))}
function date(){return new Intl.DateTimeFormat("en-CA",{timeZone:"Asia/Riyadh"}).format(new Date())}
function time(){return new Intl.DateTimeFormat("en-GB",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(new Date())}
function audit(action,userId,meta={}){db.audit.push({id:id(),action,userId,at:new Date().toISOString(),meta})}
function safe(u){const {password,...x}=u;return x}
app.post("/api/login",(q,s)=>{let {email,password}=q.body||{},u=db.users.find(x=>x.email.toLowerCase()==String(email||"").toLowerCase()&&x.password===password&&x.active);if(!u)return s.status(401).json({error:"البريد أو كلمة المرور غير صحيحة"});audit("login",u.id);save();s.json({user:safe(u)})});
app.get("/api/bootstrap",(q,s)=>{let company=db.companies[0];s.json({company,branches:db.branches,schedules:db.schedules,users:db.users.map(safe),leaves:db.leaves,holidays:db.holidays})});
app.get("/api/dashboard",(q,s)=>{let d=q.query.date||date(),company=db.companies[0],emps=db.users.filter(u=>u.companyId===company.id&&u.role==="employee"),rows=db.attendance.filter(a=>a.date===d);s.json({date:d,company,employees:emps.map(safe),rows,stats:{employees:emps.length,present:new Set(rows.filter(x=>x.type==="checkin").map(x=>x.userId)).size,late:rows.filter(x=>x.type==="checkin"&&x.late).length,absent:Math.max(0,emps.length-new Set(rows.filter(x=>x.type==="checkin").map(x=>x.userId)).size)}})});
app.get("/api/employee/:uid",(q,s)=>{let u=db.users.find(x=>x.id===q.params.uid);if(!u)return s.status(404).json({error:"الموظف غير موجود"});s.json({user:safe(u),rows:db.attendance.filter(a=>a.userId===u.id).slice(-100).reverse()})});
app.post("/api/attendance",(q,s)=>{let {userId,type,lat,lng,accuracy,deviceId,branchId}=q.body||{},u=db.users.find(x=>x.id===userId&&x.active&&x.role==="employee"),b=db.branches.find(x=>x.id===(branchId||u?.branchId));if(!u||!b)return s.status(400).json({error:"بيانات الموظف أو الفرع غير صحيحة"});if(![lat,lng,accuracy].every(Number.isFinite))return s.status(400).json({error:"بيانات الموقع غير صالحة"});if(accuracy>150)return s.status(400).json({error:"دقة GPS غير كافية. حاول في مكان مفتوح."});let dist=hav(lat,lng,b.lat,b.lng),inside=dist<=b.radius;if(!inside)return s.status(403).json({error:`أنت خارج نطاق الفرع بمسافة تقريبية ${Math.round(dist)} متر`});let d=date(),today=db.attendance.filter(a=>a.userId===u.id&&a.date===d);if(type==="checkin"&&today.some(a=>a.type==="checkin"))return s.status(409).json({error:"تم تسجيل الحضور مسبقًا اليوم"});if(type==="checkout"&&(!today.some(a=>a.type==="checkin")||today.some(a=>a.type==="checkout")))return s.status(409).json({error:today.some(a=>a.type==="checkout")?"تم تسجيل الانصراف مسبقًا":"يجب تسجيل الحضور أولًا"});if(u.deviceId&&u.deviceId!==deviceId)return s.status(403).json({error:"هذا الجهاز غير معتمد لهذا الموظف. يلزم موافقة الإدارة."});if(!u.deviceId){u.deviceId=deviceId;audit("device_bound",u.id,{deviceId})}
let now=new Date(),t=time(),sched=db.schedules.find(x=>x.id==="s1"),late=false;if(type==="checkin"&&sched){let [h,m]=sched.start.split(":").map(Number),cur=now.toLocaleString("en-US",{timeZone:"Asia/Riyadh",hour:"2-digit",minute:"2-digit",hour12:false}).split(":").map(Number);late=(cur[0]*60+cur[1])>(h*60+m+sched.grace)}
let rec={id:id(),companyId:u.companyId,branchId:b.id,userId:u.id,date:d,type,time:t,serverTimestamp:now.toISOString(),lat,lng,accuracy:Math.round(accuracy),distanceMeters:Math.round(dist),late,deviceId};db.attendance.push(rec);audit(type,u.id,{recordId:rec.id});save();s.json({ok:true,record:rec})});
app.post("/api/company",(q,s)=>{let x=q.body||{},c=db.companies[0];Object.assign(c,{name:String(x.name||c.name),lat:Number(x.lat),lng:Number(x.lng),radius:Number(x.radius),timezone:"Asia/Riyadh"});save();s.json(c)});
app.post("/api/branch",(q,s)=>{let x=q.body||{};if(!x.name||!Number.isFinite(+x.lat)||!Number.isFinite(+x.lng))return s.status(400).json({error:"بيانات الفرع غير صحيحة"});let b={id:id(),companyId:"c1",name:x.name,lat:+x.lat,lng:+x.lng,radius:+x.radius||150};db.branches.push(b);save();s.json(b)});
app.post("/api/employee",(q,s)=>{let x=q.body||{};if(!x.name||!x.email)return s.status(400).json({error:"الاسم والبريد مطلوبان"});let u={id:id(),companyId:"c1",branchId:x.branchId||"b1",name:x.name,email:x.email,password:x.password||"123456",role:"employee",active:true,deviceId:null};db.users.push(u);audit("employee_created","u1",{employeeId:u.id});save();s.json(safe(u))});
app.post("/api/leave",(q,s)=>{let x=q.body||{};let l={id:id(),companyId:"c1",userId:x.userId,from:x.from,to:x.to,type:x.type||"إجازة",status:"pending",note:x.note||""};db.leaves.push(l);audit("leave_created",x.userId,{leaveId:l.id});save();s.json(l)});
app.post("/api/leave/:id/status",(q,s)=>{let l=db.leaves.find(x=>x.id===q.params.id);if(!l)return s.status(404).json({error:"الطلب غير موجود"});l.status=q.body.status==="approved"?"approved":"rejected";audit("leave_"+l.status,"u1",{leaveId:l.id});save();s.json(l)});
app.get("/api/audit",(q,s)=>s.json(db.audit.slice(-200).reverse()));
app.get("/api/export",(q,s)=>{let rows=db.attendance.map(a=>{let u=db.users.find(x=>x.id===a.userId);return [a.date,u?.name||"",a.type,a.time,a.accuracy,a.distanceMeters,a.late?"نعم":"لا"].join(",")});s.setHeader("Content-Type","text/csv; charset=utf-8");s.setHeader("Content-Disposition",'attachment; filename="attendance.csv"');s.send("\ufeffالتاريخ,الموظف,العملية,الوقت,دقة GPS,المسافة,متأخر\n"+rows.join("\n"))});
app.get("*",(q,s)=>s.sendFile(path.join(__dirname,"public","index.html")));
app.listen(PORT,()=>console.log("Smart Attendance on "+PORT));