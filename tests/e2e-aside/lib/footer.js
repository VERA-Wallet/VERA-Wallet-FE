})().catch((e) => { console.log('FATAL ' + ((e && e.stack) || String(e)).slice(0, 800)); });
const _pass = R.filter((r) => r.pass && !r.skipped).length, _skip = R.filter((r) => r.skipped).length, _fail = R.filter((r) => !r.pass).length;
console.log('SUMMARY pass=' + _pass + ' fail=' + _fail + ' skip=' + _skip + ' total=' + R.length);
console.log('RESULTS_JSON ' + JSON.stringify(R));
