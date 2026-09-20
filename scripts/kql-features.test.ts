import {detectKqlFeatures, detectTables, downgradeBlockers} from './kql-features.ts'
const KNOWN = ['SigninLogs','CommonSecurityLog','DeviceProcessEvents','IdentityLogonEvents','AuditLogs','CloudAppEvents']
const cases = [
  {n:'plain summarize', kql:`SigninLogs | where ResultType == 0 | summarize c=count() by UserPrincipalName`, wantF:['aggregationOnly'], wantT:['SigninLogs']},
  {n:'real join', kql:`SigninLogs\n| where ResultType != 0\n| join kind=inner (IdentityLogonEvents) on $left.UPN == $right.AccountUpn\n| summarize count()`, wantF:['join'], wantT:['SigninLogs','IdentityLogonEvents']},
  {n:'TRAP: "join" in a string literal', kql:`DeviceProcessEvents | where ProcessCommandLine has "join-domain" | project DeviceName`, wantF:[], wantT:['DeviceProcessEvents']},
  {n:'TRAP: join in a comment', kql:`// we removed the join here for cost\nSigninLogs | where ResultType == 50126`, wantF:[], wantT:['SigninLogs']},
  {n:'union at query start', kql:`union SigninLogs, AuditLogs | where TimeGenerated > ago(1d)`, wantF:['union'], wantT:['SigninLogs','AuditLogs']},
  {n:'externaldata', kql:`let bad = externaldata(ip:string) [@"https://x/l.csv"] with(format="csv");\nCommonSecurityLog | where SourceIP in (bad)`, wantF:['externaldata'], wantT:['CommonSecurityLog']},
  {n:'user-defined function', kql:`let norm = (name:string) { tolower(name) };\nSigninLogs | extend u = norm(UPN)`, wantF:['userDefinedFunction'], wantT:['SigninLogs']},
  {n:'TRAP: plain let is NOT a UDF', kql:`let win = 7d;\nSigninLogs | where TimeGenerated > ago(win) | summarize count()`, wantF:['aggregationOnly'], wantT:['SigninLogs']},
  {n:'cross-workspace', kql:`workspace("other").SigninLogs | where ResultType == 0`, wantF:['crossWorkspace'], wantT:['SigninLogs']},
  {n:'lookup', kql:`CommonSecurityLog | lookup kind=leftouter AuditLogs on Computer`, wantF:['lookup'], wantT:['CommonSecurityLog','AuditLogs']},
]
const eq=(a,b)=>JSON.stringify([...a].sort())===JSON.stringify([...b].sort())
let fail=0
for (const c of cases){
  const f=detectKqlFeatures(c.kql), t=detectTables(c.kql,KNOWN)
  const okF=eq(f,c.wantF), okT=eq(t,c.wantT)
  if(!okF||!okT){fail++;console.log(`FAIL ${c.n}`)
    if(!okF)console.log(`   features got [${f}] want [${c.wantF}]`)
    if(!okT)console.log(`   tables   got [${t}] want [${c.wantT}]`)
  } else console.log(`ok   ${c.n}  -> [${f.join(', ')||'none'}]`)
}
console.log(`\n${cases.length} casos, ${fail} fallos`)
console.log('\n--- CommonSecurityLog (410 GB/día) -> auxiliary ---')
for (const r of [
  {id:'DET-0007',ruleType:'scheduled',kqlFeatures:['join'],lookbackDays:45},
  {id:'DET-0031',ruleType:'anomaly',kqlFeatures:['aggregationOnly'],lookbackDays:7},
]){ console.log(`\n${r.id} (${r.ruleType}):`); const b=downgradeBlockers(r,'auxiliary'); b.length?b.forEach(x=>console.log('  - '+x)):console.log('  (sin bloqueo)') }
console.log('\n--- los mismos -> basic ---')
for (const r of [
  {id:'DET-0007',ruleType:'scheduled',kqlFeatures:['join'],lookbackDays:45},
  {id:'DET-0031',ruleType:'anomaly',kqlFeatures:['aggregationOnly'],lookbackDays:7},
]){ console.log(`\n${r.id} (${r.ruleType}):`); const b=downgradeBlockers(r,'basic'); b.length?b.forEach(x=>console.log('  - '+x)):console.log('  (sin bloqueo)') }
process.exit(fail?1:0)
