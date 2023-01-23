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




