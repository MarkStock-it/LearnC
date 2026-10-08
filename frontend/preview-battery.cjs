/* Regression battery for the REAL-clang browser engine.
 * Compiles the actual frontend modules (wasiToolchain, wasiClang, cPreview)
 * with tsc, builds the toolchain from the disk files, and cross-checks every
 * program against gcc. Expectations are declared: the battery FAILS on
 * anything else.
 *
 * Compiled output goes to /tmp (frontend/ is `"type": "module"`, which would
 * force tsc's CommonJS output to load as ESM and crash). NODE_PATH keeps
 * bare imports (`pako`, `@runno/wasi`) resolving to frontend/node_modules.
 *
 * Run: node preview-battery.cjs   (needs gcc + npm install done)
 * Exit 0 = all green.
 */
const { execFileSync, execSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const OUT = '/tmp/learnc-battery';
fs.rmSync(OUT, { recursive: true, force: true });
execSync(`npx tsc src/lib/wasiToolchain.ts src/lib/wasiClang.ts src/lib/cPreview.ts --ignoreConfig --outDir ${OUT} --module commonjs --target es2020 --skipLibCheck`, {
  cwd: __dirname,
  stdio: 'inherit',
  env: { ...process.env, NODE_PATH: path.join(__dirname, 'node_modules') },
});
process.env.NODE_PATH = path.join(__dirname, 'node_modules');
require('node:module').Module._initPaths();
const { inflate } = require('pako');
const { extractUstar } = require(path.join(OUT, 'wasiToolchain.js'));
const { compileC, runCompiledProgram } = require(path.join(OUT, 'wasiClang.js'));
const { compareOutputs } = require(path.join(OUT, 'cPreview.js'));

const stamps = () => {
  const now = new Date();
  return { access: now, modification: now, change: now };
};

async function loadToolchain() {
  const dir = path.join(__dirname, 'public', 'toolchain');
  const clangWasm = fs.readFileSync(path.join(dir, 'clang.wasm'));
  const linkerWasm = fs.readFileSync(path.join(dir, 'wasm-ld.wasm'));
  const gz = fs.readFileSync(path.join(dir, 'clang-fs.tar.gz'));
  const sysroot = {};
  for (const entry of extractUstar(inflate(gz))) {
    const virtualPath = entry.name.startsWith('/') ? entry.name : `/${entry.name}`;
    sysroot[virtualPath] = { path: virtualPath, mode: 'binary', content: entry.data, timestamps: stamps() };
  }
  return { clangWasm, linkerWasm, sysroot };
}

const gccOut = (code, stdin) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'batt-'));
  const src = path.join(dir, 't.c');
  const bin = path.join(dir, 't');
  fs.writeFileSync(src, code);
  execFileSync('gcc', ['-Wall', '-Wextra', '-std=c99', src, '-o', bin, '-lm'], { stdio: 'pipe' });
  return execFileSync(bin, { input: stdin, encoding: 'utf8', timeout: 5000 });
};

const programs = {
  skeleton: [`#include <stdio.h>\nint main(void){/* comment */printf("hi\\n");return 0;}`, '', 'match'],
  sum_array: [`#include <stdio.h>\nint main(void){int n;scanf("%d",&n);int s=0;for(int i=0;i<n;i++){int x;scanf("%d",&x);s+=x;}printf("%d\\n",s);return 0;}`, '5\n1 2 3 4 5\n', 'match'],
  arr_input_loop: [`#include <stdio.h>\nint main(void){int n;scanf("%d",&n);int a[100];for(int i=0;i<n;i++)scanf("%d",&a[i]);\nfor(int i=n-1;i>=0;i--)printf("%d ",a[i]);printf("\\n");return 0;}`, '4\n10 20 30 40\n', 'match'],
  matrix_mult: [`#include <stdio.h>\nint main(void){int a[2][2],b[2][2];for(int i=0;i<2;i++)for(int j=0;j<2;j++)scanf("%d",&a[i][j]);\nfor(int i=0;i<2;i++)for(int j=0;j<2;j++)scanf("%d",&b[i][j]);\nfor(int i=0;i<2;i++){for(int j=0;j<2;j++){int s=0;for(int k=0;k<2;k++)s+=a[i][k]*b[k][j];printf("%d ",s);}printf("\\n");}return 0;}`, '1 2 3 4\n5 6 7 8\n', 'match'],
  grade_char: [`#include <stdio.h>\nint main(void){char g;scanf("%c",&g);if(g=='A')printf("top\\n");else printf("other\\n");return 0;}`, 'A\n', 'match'],
  mixed_char: [`#include <stdio.h>\nint main(void){int a;char c;float f;scanf("%d %c %f",&a,&c,&f);printf("%d|%c|%.1f\\n",a,c,f);return 0;}`, '42 Z 3.25\n', 'match'],
  doubles: [`#include <stdio.h>\nint main(void){double x;scanf("%lf",&x);printf("%.2f\\n",x*2);return 0;}`, '3.14\n', 'match'],
  string_rev: [`#include <stdio.h>\n#include <string.h>\nint main(void){char s[100];scanf("%s",s);int n=strlen(s);for(int i=0;i<n/2;i++){char t=s[i];s[i]=s[n-1-i];s[n-1-i]=t;}printf("%s\\n",s);return 0;}`, 'hello\n', 'match'],
  structs: [`#include <stdio.h>\nstruct P{char name[20];int score;};\nint main(void){struct P ps[2];for(int i=0;i<2;i++)scanf("%s %d",ps[i].name,&ps[i].score);\nint best=0;for(int i=1;i<2;i++)if(ps[i].score>ps[best].score)best=i;\nprintf("%s %d\\n",ps[best].name,ps[best].score);return 0;}`, 'amy 90\nbob 95\n', 'match'],
  linked_list: [`#include <stdio.h>\n#include <stdlib.h>\ntypedef struct node{int data;struct node *next;} Node;\nint main(void){Node *head=NULL;for(int i=3;i>=1;i--){Node *n=malloc(sizeof(Node));n->data=i*10;n->next=head;head=n;}\nint s=0;for(Node *p=head;p!=NULL;p=p->next)s+=p->data;\nprintf("%d\\n",s);return 0;}`, '', 'match'],
  malloc_prog: [`#include <stdio.h>\n#include <stdlib.h>\nint main(void){int n;scanf("%d",&n);int *a=malloc(n*sizeof(int));for(int i=0;i<n;i++)scanf("%d",&a[i]);\nfor(int i=n-1;i>=0;i--)printf("%d ",a[i]);printf("\\n");free(a);return 0;}`, '4\n10 20 30 40\n', 'match'],
  qsort_prog: [`#include <stdio.h>\n#include <stdlib.h>\nint cmp(const void *a,const void *b){return *(int*)a-*(int*)b;}\nint main(void){int a[5]={5,3,4,1,2};qsort(a,5,sizeof(int),cmp);\nfor(int i=0;i<5;i++)printf("%d ",a[i]);printf("\\n");return 0;}`, '', 'match'],
  enum_prog: [`#include <stdio.h>\nenum Color{RED,GREEN,BLUE};\nint main(void){enum Color c=GREEN;printf("%d\\n",c);return 0;}`, '', 'match'],
  longlong: [`#include <stdio.h>\nint main(void){long long x;scanf("%lld",&x);printf("%lld\\n",x*2);return 0;}`, '4000000000\n', 'match'],
  str_width: [`#include <stdio.h>\nint main(void){char s[20];scanf("%19s",s);printf("[%s]\\n",s);return 0;}`, 'hello\n', 'match'],
  recursion: [`#include <stdio.h>\nint fib(int n){if(n<2)return n;return fib(n-1)+fib(n-2);}\nint main(void){int n;scanf("%d",&n);printf("%d\\n",fib(n));return 0;}`, '12\n', 'match'],
  leap: [`#include <stdio.h>\nint main(void){int y;scanf("%d",&y);if((y%4==0&&y%100!=0)||y%400==0)printf("leap\\n");else printf("common\\n");return 0;}`, '1900\n', 'match'],
  ptr_arith: [`#include <stdio.h>\nint main(void){int a[3]={10,20,30};int *p=a;printf("%d %d\\n",*(p+1),*(p+2));return 0;}`, '', 'match'],
  fgets_prog: [`#include <stdio.h>\n#include <string.h>\nint main(void){char line[100];fgets(line,100,stdin);line[strcspn(line,"\\n")]=0;printf("[%s]\\n",line);return 0;}`, 'hello world\n', 'match'],
  define_max: [`#include <stdio.h>\n#define MAX 100\nint main(void){int a[MAX];a[0]=7;printf("%d\\n",a[0]);return 0;}`, '', 'match'],
  while_switch: [`#include <stdio.h>\nint main(void){int n;scanf("%d",&n);int i=0,s=0;while(i<n){i++;if(i%2==0)continue;s+=i;}\nswitch(s){case 9:printf("nine\\n");break;default:printf("%d\\n",s);}return 0;}`, '5\n', 'match'],
  math_prog: [`#include <stdio.h>\n#include <math.h>\nint main(void){printf("%.3f %.3f\\n",sqrt(2.0),pow(2.0,10.0));return 0;}`, '', 'match'],
  // wasm32 `long` is 32-bit (server gcc is 64-bit): runs fine, value differs.
  long_big: [`#include <stdio.h>\nint main(void){long x=1099511627776L;printf("%ld\\n",x);return 0;}`, '', 'runs-diverges'],
  compile_error: [`#include <stdio.h>\nint main(void){printf("oops")\nreturn 0;}`, '', 'compile-fail'],
};

(async () => {
  const toolchain = await loadToolchain();
  console.log('toolchain loaded from disk');
  let pass = 0;
  let fail = 0;
  for (const [name, [code, stdin, want]] of Object.entries(programs)) {
    const expected = want === 'compile-fail' ? null : gccOut(code, stdin);
    try {
      const compiled = await compileC(toolchain, code);
      if (!compiled.ok) {
        if (want === 'compile-fail' && compiled.diagnostics.length > 10) {
          console.log(`${name}: ok [compile-fail with diagnostics]`);
          pass += 1;
        } else {
          console.log(`${name}: UNEXPECTED COMPILE FAIL: ${compiled.diagnostics.slice(0, 200)}`);
          fail += 1;
        }
        continue;
      }
      if (want === 'compile-fail') {
        console.log(`${name}: expected compile failure but it compiled <-- REGRESSION`);
        fail += 1;
        continue;
      }
      const ran = await runCompiledProgram(compiled.programWasm, stdin);
      if (want === 'runs-diverges') {
        if (ran.exitCode === 0) {
          console.log(`${name}: ok [runs; wasm32-long divergence documented: ${JSON.stringify(ran.stdout)}]`);
          pass += 1;
        } else {
          console.log(`${name}: expected clean run, got exit ${ran.exitCode}`);
          fail += 1;
        }
        continue;
      }
      const { passed } = compareOutputs(expected, ran.stdout);
      if (passed && ran.exitCode === 0) {
        console.log(`${name}: ok [match]`);
        pass += 1;
      } else {
        console.log(`${name}: MISMATCH! exit=${ran.exitCode}\n  gcc:   ${JSON.stringify(expected)}\n  clang: ${JSON.stringify(ran.stdout)}\n  stderr: ${JSON.stringify(ran.stderr.slice(0, 200))}`);
        fail += 1;
      }
    } catch (e) {
      console.log(`${name}: HARNESS ERROR — ${String(e && e.message ? e.message : e).slice(0, 200)}`);
      fail += 1;
    }
  }
  console.log(`\nPASS=${pass} FAIL=${fail}`);
  process.exit(fail === 0 ? 0 : 1);
})().catch((e) => {
  console.error('FATAL', e);
  process.exit(1);
});
