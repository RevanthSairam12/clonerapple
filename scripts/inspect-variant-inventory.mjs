/** Read-only inventory/allocation census. No apply mode; no automatic allocation. */
import fs from 'node:fs';
import { createHash } from 'node:crypto';
import postgres from 'postgres';
let sql;
try {
  const env={};
  if(fs.existsSync('.env.local')) for(const line of fs.readFileSync('.env.local','utf8').split(/\r?\n/)) {
    const m=line.match(/^\s*(DATABASE_URL|DATABASE_SSL)\s*=\s*(.*?)\s*$/);
    if(m) env[m[1]]=m[2].replace(/^(['"])(.*)\1$/,'$2');
  }
  const connection=process.env.DATABASE_URL || env.DATABASE_URL;
  if(!connection) throw new Error('configuration');
  const host=new URL(connection).hostname;
  sql=postgres(connection,{max:1,prepare:false,connect_timeout:10,idle_timeout:5,
    ssl:(process.env.DATABASE_SSL || env.DATABASE_SSL)==='false'?undefined:'require',onnotice:()=>{},
    connection:{default_transaction_read_only:'on',search_path:'public',statement_timeout:20000,lock_timeout:3000}});
  const report=await sql.begin('isolation level repeatable read read only',async tx=>{
    const [state]=await tx`show transaction_read_only`;
    if(state.transaction_read_only!=='on') throw new Error('readonly');
    const rows=await tx`select p.id,s.track_inventory,s.on_hand,s.reserved,
      (select count(*)::int from product_variants v where v.product_id=p.id and v.is_active) as active_variants
      from products p left join stock s on s.product_id=p.id and s.variant_id is null
      where p.deleted_at is null order by p.id`;
    const allocations=rows.filter(row=>row.track_inventory && Number(row.active_variants)>1);
    const [variants]=await tx`select count(*)::int as total,count(*) filter(where sku is null or btrim(sku)='')::int as missing_sku from product_variants`;
    const [holds]=await tx`select count(*)::int as active from orders where reservation_state='ACTIVE'`;
    return {host,mode:'read-only',products:rows.length,tracked:rows.filter(r=>r.track_inventory).length,
      untracked:rows.filter(r=>r.track_inventory===false).length,missingStockRows:rows.filter(r=>r.track_inventory==null).length,
      variants,holds,allocationCandidates:allocations,proposedWrites:0,
      decision:'No stock split proposed. Configure explicit combinations and obtain owner allocation approval.'};
  });
  const digest=createHash('sha256').update(JSON.stringify(report)).digest('hex');
  console.log(JSON.stringify({...report,digest},null,2));
} catch {
  console.error('Read-only inventory census refused or failed; no writes attempted. Connection/error details withheld.');
  process.exitCode=1;
} finally { if(sql) await sql.end({timeout:5}); }
