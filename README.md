Ultimate Wordle Solver
======================

Solves [Wordle](https://www.nytimes.com/games/wordle/index.html) puzzle game.

The algorithm is optimized for minimum number of submits.

For the Wordle's original dictionary (with 2,309 words), 3.785 submits are required on average, and for the worst case, five submits are required currently (Note: you can submit six answers to the original Wordle).

Install
-------

```bash
$ git clone https://github.com/visvirial/wordle-solver.git
$ cd wordle-solver
$ npm install
```

How to Use
----------

### Interactive Solver

```bash
$ npm run interactive-solver

> wordle-solver@0.0.1 interactive-solver
> ts-node ./scripts/interactive-solver.ts

Wordle interactive solver.
Input the dictionary name: wordle-5
[WordleSolver.constructor] 2,466ms.
There are 2,309 candidates.
=== Trial: 1 ===
RAISE
Input the result (@ for green, + for yellow, _ for gray): ____@
____@
There are 61 candidates.
=== Trial: 2 ===
CLOUD
Input the result (@ for green, + for yellow, _ for gray): _@_++
_@_++
There are 1 candidates.
The answer is ELUDE. Congrats!
```





### Web Frontend

A browser UI (vanilla TypeScript + Vite) lives in `web/`. The solver runs in a Web Worker and gives the same suggestions as the CLI.

```bash
$ npm run web:dev      # development server
$ npm run web:build    # type-check and build into dist/
$ npm run web:preview  # serve the built app
$ npm run web:test     # engine/UI unit tests (incl. parity with the CLI solver)
```

Type or accept the suggested word, click tiles to cycle gray → yellow → green (or press 1/2/3), then submit.
