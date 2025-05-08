# SAT Solver Implementations: DP vs DPLL

## Overview

This project provides TypeScript implementations of two foundational algorithms for solving the Boolean Satisfiability (SAT) problem:

1.  **Davis-Putnam (DP) Algorithm:** Based on variable elimination via resolution. (Currently, the main focus of `main.ts` is DPLL). **Note:** The basic DP implementation included (`dpSolver`) can be very memory-intensive due to the resolution step potentially causing the number of clauses to grow significantly.
2.  **Davis-Putnam-Logemann-Loveland (DPLL) Algorithm:** A refinement using backtracking search, unit propagation, and pure literal elimination.

The primary goal is to offer both a **theoretical** overview and an **experimental comparison** of these algorithms, with a particular focus on the impact of different branching heuristics within the DPLL framework, as implemented in `main.ts`.

## Input Format

The solver in `main.ts` expects input formulas in the standard **DIMACS CNF** format. Example files are typically placed in the `data/` directory.

## Technology

*   TypeScript
*   Node.js

## Setup

1.  **Prerequisites:**
    *   Ensure you have [Node.js](https://nodejs.org/) installed (which includes npm).
    *   It's recommended to have TypeScript and ts-node installed globally if you want to run the `.ts` files directly without compiling first:
        ```bash
        npm install -g typescript ts-node
        ```

2.  **Project Dependencies:**
    *   Currently, the `main.ts` script uses built-in Node.js modules (`fs`, `path`) and has no external npm package dependencies listed in a `package.json`. If you were to add dependencies later (e.g., for more advanced CSV generation or a testing framework), you would typically run:
        ```bash
        npm install
        ```
    *   For now, this step might not be strictly necessary if you only have `main.ts` and `types.ts` with no external libraries.

## Running the DPLL SAT Solver and Benchmark Harness

The `main.ts` script is configured to run a benchmark harness that tests the DP and DPLL SAT solvers with different heuristics on a collection of CNF files.

1.  **Prepare Benchmark Files:**
    *   Create a directory named `data` in the root of the project if it doesn't already exist.
    *   Inside the `data` directory, you will manage two list files:
        *   `data/benchmarks_dp.list`: This file should list the CNF filenames (one per line, without the `data/` prefix) that you want the **DP algorithm** to attempt. These should generally be **smaller instances** due to DP's memory intensiveness.
        *   `data/benchmarks_all.list`: This file should list ALL CNF filenames (one per line, without the `data/` prefix) that you want the **DPLL algorithm** to run on. The DP algorithm will *also* run on files from this list *if and only if* they are also present in `benchmarks_dp.list`.
    *   The script assumes these `.cnf` files are located directly within the `data/` directory.
        *Example `data/benchmarks_dp.list` content:*
        ```
        # Comments like this are ignored
        # Small files for DP testing
        dp_sat_1.cnf
        dp_unsat_1.cnf
        ```
        *Example `data/benchmarks_all.list` content:*
        ```
        # Comments like this are ignored
        # All files for DPLL testing (and DP if listed in benchmarks_dp.list)
        dp_sat_1.cnf
        dp_unsat_1.cnf
        uf20-0995.cnf
        uuf50-01.cnf
        my_custom_benchmark.cnf
        ```
    *   Place your actual `.cnf` files (e.g., `dp_sat_1.cnf`, `uf20-0995.cnf`) into the `data/` directory.
    *   If these list files are not found, example versions will be created for you.

2.  **Execute the Script:**
    *   Navigate to the root directory of the project in your terminal.
    *   Run the script using `ts-node`:
        ```bash
        ts-node main.ts
        ```
    *   Alternatively, if you compile the TypeScript to JavaScript (e.g., using `tsc`), you can run the compiled file:
        ```bash
        tsc main.ts
        node main.js
        ```

3.  **Understanding the Output:**
    *   **Console Output:**
        *   The script will first indicate if it's creating example list files (if they weren't found).
        *   It will then log which benchmark files it's loading from each list.
        *   For each benchmark file from `benchmarks_all.list`, it will process it with each available DPLL heuristic (`first`, `random`, `moms`).
        *   The DP algorithm will be run on files specified in `benchmarks_dp.list`. If a file is processed by DPLL and is *not* in `benchmarks_dp.list`, the DP run for that file will be skipped, and a message will indicate this.
        *   Immediate feedback on the status (SAT/UNSAT/DP_LIMIT_REACHED/SKIPPED etc.), time taken, and decision count (for DPLL) will be printed.
        *   Finally, a "Benchmark Summary" table will be printed to the console, summarizing the results for all executed file-heuristic combinations.
    *   **CSV Output (Optional but Recommended):**
        *   The script is configured to also write the benchmark results to a CSV file named `benchmark_results.csv` in the root project directory.
        *   This CSV file can be easily imported into spreadsheet programs (like Excel, Google Sheets, LibreOffice Calc) for more detailed analysis, sorting, filtering, and charting of the results. Columns include: File, Heuristic, Status, Time(miliseconds), and Decisions.
    *   **Note on DP Algorithm Results:** The classic DP algorithm implemented here (`dpSolver`) often requires a large amount of memory because the resolution step can significantly increase the number of clauses. For larger benchmarks, you might observe statuses like `DP_CLAUSE_LIMIT` (clause threshold exceeded) or `DP_MAX_ITERATIONS` (iteration limit reached), or the process might even crash due to insufficient memory. This is an expected behavior illustrating a key limitation DPLL was designed to overcome. Running DP only on specifically chosen smaller files (via `benchmarks_dp.list`) helps manage this.

## Development Notes

*   The core DPLL logic, including unit propagation, pure literal elimination, and variable selection heuristics, is implemented in `main.ts`.
*   Type definitions are in `types.ts`.
*   The classic Davis-Putnam (DP) algorithm (`dpSolver`) is also implemented. Be aware that this version uses the resolution rule for variable elimination and can consume substantial memory on non-trivial problems, potentially leading to `DP_CLAUSE_LIMIT` or `DP_MAX_ITERATIONS` results in the benchmarks.