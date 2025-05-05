# SAT Solver Implementations: DP vs DPLL

## Overview

This project provides TypeScript implementations of two foundational algorithms for solving the Boolean Satisfiability (SAT) problem:

1.  **Davis-Putnam (DP) Algorithm:** Based on variable elimination via resolution.
2.  **Davis-Putnam-Logemann-Loveland (DPLL) Algorithm:** A refinement using backtracking search, unit propagation, and potentially pure literal elimination.

The primary goal is to offer both a **theoretical** overview and an **experimental comparison** of these algorithms, with a particular focus on the impact of different branching heuristics within the DPLL framework.

## Input Format

The solvers currently expect input formulas in the standard **DIMACS CNF** format. An example can be found in `data/test.cnf`.

## Technology

*   TypeScript

## Usage

```bash
npm install
```