/**
 * A small HTML report with a working script (a chart and tabs) and probes that try to reach
 * the app: its page, its storage, its database, the network. Shown through the same viewer as
 * vault files, every probe must read 「届かない」/「止まった」. Used by the demo and by Settings.
 */
export const HTML_CHECK = `<!doctype html>
<html lang="ja"><head><meta charset="utf-8"><title>読書会 振り返り（ダミー）</title>
<style>body{font-family:sans-serif;padding:20px;line-height:1.7}.bar{height:14px;background:#2d5a46;border-radius:7px;margin:6px 0}
.tab{display:none}.tab.on{display:block}button{padding:6px 12px;margin-right:6px}code{background:#eee;padding:1px 4px}</style></head>
<body>
<h1>読書会 振り返り</h1>
<p>参加者の満足度（ダミー）</p>
<div id="chart"></div>
<p><button onclick="show(1)">感想</button><button onclick="show(2)">次回</button></p>
<div class="tab on" id="t1">「余白の設計」が読みやすかった、という声が多かった。</div>
<div class="tab" id="t2">次回は11月。会場は駅前の会議室。</div>
<h2>安全の確認</h2>
<ul id="probe"></ul>
<script>
  var data=[['とても良い',7],['良い',4],['ふつう',1]];
  document.getElementById('chart').innerHTML=data.map(function(d){return '<div>'+d[0]+'（'+d[1]+'）</div><div class="bar" style="width:'+(d[1]*12)+'%"></div>'}).join('');
  function show(n){document.querySelectorAll('.tab').forEach(function(e){e.classList.remove('on')});document.getElementById('t'+n).classList.add('on')}
  function probe(name,fn){var li=document.createElement('li');try{var r=fn();li.textContent=name+'：見えた（'+String(r).slice(0,30)+'）';li.style.color='red'}catch(e){li.textContent=name+'：届かない';li.style.color='green'}document.getElementById('probe').appendChild(li)}
  probe('アプリの画面',function(){return parent.document.title});
  probe('アプリの保存場所',function(){return localStorage.length});
  probe('端末のデータベース',function(){if(!indexedDB.open)throw 0;var r=indexedDB.open('vault-mobile');return r?'opened':'none'});
  var li=document.createElement('li');li.id='net';li.textContent='外への送信：確認中';document.getElementById('probe').appendChild(li);
  fetch('https://example.com/').then(function(){li.textContent='外への送信：通った';li.style.color='red'},function(){li.textContent='外への送信：止まった';li.style.color='green'});
</script>
</body></html>
`;
