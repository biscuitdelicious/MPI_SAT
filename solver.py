import time
import random
import os
import csv
from typing import Set, List, Dict, Tuple, Union, Optional, Callable

# --- Basic Types (from previous context, ensuring they are here) ---
Literal = int
Clause = Set[Literal]
CnfFormula = List[Clause]
Assignment = Dict[int, bool]
CONFLICT_STR = 'CONFLICT'

# --- DP Solver specific constants and statuses ---
MAX_ITERATIONS_DP = 2000  # From main.ts: initialVarCount > 0 ? initialVarCount + 10 : 20; simplified here
MAX_CLAUSES_DP = 5000    # From main.ts: MAX_CLAUSES_DP = 5000 (TS value was 5000, but summary mentions 500k for python)
                           # Let's use a higher value for Python as per summary, adjust if needed
                           # Reverting to 5000 to match TS more closely for "take the way I implemented DP from main.ts"

DP_MAX_ITERATIONS_REACHED = 'DP_MAX_ITERATIONS_REACHED'
DP_CLAUSE_LIMIT_REACHED = 'DP_CLAUSE_LIMIT' # Match TS
SATISFIABLE_STR = 'SATISFIABLE'
UNSATISFIABLE_STR = 'UNSATISFIABLE'

DPResultStatus = str # SATISFIABLE_STR, UNSATISFIABLE_STR, DP_MAX_ITERATIONS_REACHED, DP_CLAUSE_LIMIT_REACHED


# --- Core Parsing and Simplification (from previous context) ---
def parse_dimacs(file_path: str) -> Optional[Tuple[CnfFormula, int, int]]:
    print(f"Debug: Starting parse_dimacs for {file_path}")
    try:
        with open(file_path, "r") as f:
            lines = f.readlines()
    except FileNotFoundError:
        print(f"Debug: FileNotFoundError in parse_dimacs: {file_path}")
        return None

    num_variables: int = 0
    num_clauses_header: int = 0
    header_found = False
    parsed_formula: CnfFormula = []
    
    line_idx = 0
    # Find header line
    print("Debug: Searching for header...")
    while line_idx < len(lines):
        line = lines[line_idx].strip()
        current_line_num_for_debug = line_idx + 1
        line_idx += 1 # Increment immediately after getting line for next loop

        if not line or line.startswith('c') or line.startswith('%'):
            print(f"Debug: Skipping line {current_line_num_for_debug} (comment/empty): {line}")
            continue

        if line.startswith('p cnf'):
            print(f"Debug: Found potential header line {current_line_num_for_debug}: {line}")
            parts = line.split()
            if len(parts) < 4:
                print(f"Debug: Invalid p cnf header line (not enough parts): '{line}'. Returning None.")
                return None
            try:
                num_variables = int(parts[2])
                num_clauses_header = int(parts[3])
                print(f"Debug: Parsed header: vars={num_variables}, clauses={num_clauses_header}")
            except ValueError:
                print(f"Debug: Could not parse numbers in 'p cnf' header: '{line}'. Returning None.")
                return None
            header_found = True
            break
        else:
            print(f"Debug: Unexpected line {current_line_num_for_debug} before p cnf header: '{line}'. Returning None.")
            return None

    if not header_found:
        print("Debug: p cnf header line not found after loop. Returning None.")
        return None

    # Parse clause lines
    print("Debug: Parsing clauses...")
    actual_clauses_parsed = 0
    while line_idx < len(lines):
        line = lines[line_idx].strip()
        current_line_num_for_debug = line_idx + 1
        line_idx += 1

        if not line or line.startswith('c') or line.startswith('%'):
            print(f"Debug: Skipping line {current_line_num_for_debug} (comment/empty): {line}")
            continue
        
        print(f"Debug: Processing clause line {current_line_num_for_debug}: {line}")
        literal_strings = [s for s in line.split() if s]
        clause: Clause = set()
        clause_ended = False
        for lit_str in literal_strings:
            try:
                literal = int(lit_str)
            except ValueError:
                print(f"Debug: Non-integer literal '{lit_str}' in line: '{line}'. Clearing clause and breaking from literals.")
                clause.clear()
                clause_ended = True
                break
            
            if literal == 0:
                clause_ended = True
                break
            clause.add(literal)

        if not clause_ended and literal_strings:
             print(f"Debug: Warning - Clause line {current_line_num_for_debug} did not end with 0: '{line}'")

        if clause:
            parsed_formula.append(clause)
            actual_clauses_parsed +=1
            print(f"Debug: Added clause: {clause}")
        elif literal_strings: # It was a non-empty line that resulted in an empty clause (e.g. just "0" or error)
             print(f"Debug: Line {current_line_num_for_debug} resulted in an empty clause (not added): {line}")


    print(f"Debug: Finished parsing clauses. Parsed {actual_clauses_parsed} clauses.")
    if actual_clauses_parsed != num_clauses_header:
        print(f"Debug: Warning - Header specified {num_clauses_header} clauses, but {actual_clauses_parsed} were parsed from content.")

    print(f"Debug: parse_dimacs returning: {len(parsed_formula)} clauses, {num_variables} vars, {num_clauses_header} header_clauses")
    return parsed_formula, num_variables, num_clauses_header

def simplify_formula(formula: CnfFormula, true_literal: Literal) -> Union[CnfFormula, str]:
    simplified_formula: CnfFormula = []
    negative_literal = -true_literal
    for clause_set in formula: # Ensure we iterate over sets if formula contains sets
        clause = set(clause_set) # Work with a copy if it's already a set, or convert list to set
        if true_literal in clause:
            continue
        new_clause = set(clause)
        if negative_literal in new_clause:
            new_clause.remove(negative_literal)
            if not new_clause: return CONFLICT_STR
        simplified_formula.append(new_clause)
    return simplified_formula

# --- DP Algorithm Helper Functions (translated from main.ts) ---

def get_variables_in_formula_dp(formula: CnfFormula) -> List[int]:
    """Gets all unique variable numbers present in the formula, sorted."""
    variables: Set[int] = set()
    for clause in formula:
        for literal in clause:
            variables.add(abs(literal))
    return sorted(list(variables)) # main.ts sorts when fetching vars for elimination

def are_formulas_semantically_same(f1: CnfFormula, f2: CnfFormula) -> bool:
    """Checks if two formulas are semantically the same."""
    if len(f1) != len(f2):
        return False
    # Convert clauses to frozensets of sorted tuples for reliable comparison
    # Matching main.ts: clause.map(c => Array.from(c).sort((a,b)=>a-b).join(','))
    f1_clause_strings = set(','.join(map(str, sorted(list(c)))) for c in f1)
    f2_clause_strings = set(','.join(map(str, sorted(list(c)))) for c in f2)
    return f1_clause_strings == f2_clause_strings


def apply_dp_unit_propagation(input_formula: CnfFormula) -> Tuple[Union[CnfFormula, str], bool]:
    """
    Applies unit propagation for DP.
    Returns (simplified_formula | 'CONFLICT', changed_flag).
    Matches main.ts behavior.
    """
    formula_to_process = [set(c) for c in input_formula]
    overall_changed = False
    
    while True: # Loop mimics the iterationChanged logic in main.ts
        iteration_changed = False
        if not formula_to_process: # Empty formula
            return formula_to_process, overall_changed
        if any(not c for c in formula_to_process): # Empty clause
             return CONFLICT_STR, True # Changed to CONFLICT

        unit_literal: Optional[Literal] = None
        for clause in formula_to_process:
            if len(clause) == 1:
                unit_literal = next(iter(clause))
                break
        
        if unit_literal is not None:
            formula_before_simplification = [set(c) for c in formula_to_process] # Deep copy
            simplified_result = simplify_formula(formula_to_process, unit_literal)

            if simplified_result == CONFLICT_STR:
                return CONFLICT_STR, True # Changed to CONFLICT
            
            # simplified_result is CnfFormula here
            if not are_formulas_semantically_same(formula_before_simplification, simplified_result):
                overall_changed = True
                iteration_changed = True # Will cause the loop to run again
            
            formula_to_process = simplified_result
        
        if not iteration_changed: # No unit literal found or no change from simplification
            break
            
    return formula_to_process, overall_changed


def apply_dp_pure_literal_elimination(input_formula: CnfFormula) -> Tuple[Union[CnfFormula, str], bool]:
    """
    Applies pure literal elimination for DP.
    Returns (simplified_formula | 'CONFLICT', changed_flag).
    Matches main.ts behavior.
    """
    formula_to_process = [set(c) for c in input_formula]
    overall_changed = False

    while True: # Loop mimics iterationChanged logic
        iteration_changed = False
        if not formula_to_process: return formula_to_process, overall_changed
        if any(not c for c in formula_to_process): return CONFLICT_STR, True

        literal_polarity: Dict[int, Dict[str, bool]] = {} # var_abs -> {'p': True/False, 'n': True/False}
        vars_in_formula = get_variables_in_formula_dp(formula_to_process)

        for var in vars_in_formula:
            literal_polarity[var] = {'p': False, 'n': False}

        for clause in formula_to_process:
            for literal in clause:
                variable = abs(literal)
                # Ensure variable is in map (can happen if vars_in_formula was from slightly stale formula)
                if variable not in literal_polarity: literal_polarity[variable] = {'p':False, 'n':False}
                if literal > 0: literal_polarity[variable]['p'] = True
                else: literal_polarity[variable]['n'] = True
        
        pure_literal_to_assign: Optional[Literal] = None
        # Sort for deterministic behavior, similar to main.ts
        for variable in sorted(vars_in_formula): 
            pol = literal_polarity.get(variable)
            if pol:
                if pol['p'] and not pol['n']: pure_literal_to_assign = variable; break
                if not pol['p'] and pol['n']: pure_literal_to_assign = -variable; break
        
        if pure_literal_to_assign is not None:
            formula_before_simplification = [set(c) for c in formula_to_process]
            simplified_result = simplify_formula(formula_to_process, pure_literal_to_assign)

            if simplified_result == CONFLICT_STR:
                return CONFLICT_STR, True
            
            if not are_formulas_semantically_same(formula_before_simplification, simplified_result):
                overall_changed = True
                iteration_changed = True
            formula_to_process = simplified_result
        
        if not iteration_changed:
            break
            
    return formula_to_process, overall_changed


def dp_solver(initial_formula: CnfFormula, num_variables_header: int) -> DPResultStatus:
    formula = [set(c) for c in initial_formula] # Deep copy
    
    # Determine max_iterations based on variable count, similar to main.ts
    # initial_var_count = len(get_variables_in_formula_dp(formula))
    # max_iter = initial_var_count + 10 if initial_var_count > 0 else 20
    # Using fixed MAX_ITERATIONS_DP for simplicity, as per Python constant definition
    
    last_formula_str_state = "" # For stalemate detection

    for iteration_count in range(MAX_ITERATIONS_DP):
        # print(f"DP Iteration {iteration_count + 1}, Clauses: {len(formula)}")
        if len(formula) > MAX_CLAUSES_DP:
            # print(f"DP Solver: Exceeded MAX_CLAUSES_DP ({MAX_CLAUSES_DP}). Aborting.")
            return DP_CLAUSE_LIMIT_REACHED

        # --- 1. Simplification Phase (UP & PLE to fixpoint) ---
        while True:
            changed_in_simplification_loop = False
            
            # Pre-simplification checks
            if not formula: return SATISFIABLE_STR
            if any(not c for c in formula): return UNSATISFIABLE_STR

            # Unit Propagation
            up_result_formula, up_changed = apply_dp_unit_propagation(formula)
            if up_result_formula == CONFLICT_STR: return UNSATISFIABLE_STR
            if up_changed: # This implies formula might have changed
                formula = up_result_formula # up_result_formula is CnfFormula
                changed_in_simplification_loop = True
                if not formula: return SATISFIABLE_STR # Check if UP emptied it
                continue # Restart simplification loop

            # Pure Literal Elimination
            ple_result_formula, ple_changed = apply_dp_pure_literal_elimination(formula)
            if ple_result_formula == CONFLICT_STR: return UNSATISFIABLE_STR
            if ple_changed: # This implies formula might have changed
                formula = ple_result_formula # ple_result_formula is CnfFormula
                changed_in_simplification_loop = True
                if not formula: return SATISFIABLE_STR # Check if PLE emptied it
                # continue # Restart simplification loop (already at end of this path)
            
            if not changed_in_simplification_loop:
                break # Exit simplification loop if no changes in a full pass

        # --- Post-Simplification Checks (again, critical) ---
        if not formula: return SATISFIABLE_STR
        if any(not c for c in formula): return UNSATISFIABLE_STR

        # --- 2. Resolution Phase ---
        vars_in_formula = get_variables_in_formula_dp(formula)
        
        if not vars_in_formula: # No variables left
             # True if formula is empty, false otherwise (e.g. [[]] which is conflict)
            return SATISFIABLE_STR if not any(not c for c in formula) else UNSATISFIABLE_STR

        var_to_eliminate = vars_in_formula[0] # Smallest variable

        clauses_with_p: CnfFormula = []
        clauses_with_not_p: CnfFormula = []
        other_clauses: CnfFormula = []

        for clause_item in formula: # clause_item is a Set[Literal]
            if var_to_eliminate in clause_item:
                clauses_with_p.append(clause_item)
            elif -var_to_eliminate in clause_item:
                clauses_with_not_p.append(clause_item)
            else:
                other_clauses.append(clause_item)

        # Stalemate check from main.ts logic (related to current formula state before deciding to continue/resolve)
        current_formula_str_for_stalemate = ','.join(sorted(['|'.join(map(str, sorted(list(c)))) for c in formula]))

        if not clauses_with_p or not clauses_with_not_p: # Variable is effectively pure for resolution
            if last_formula_str_state == current_formula_str_for_stalemate :
                return SATISFIABLE_STR 
            last_formula_str_state = current_formula_str_for_stalemate
            continue 


        resolvents: CnfFormula = []
        for c1 in clauses_with_p:
            for c2 in clauses_with_not_p:
                r = set()
                for lit in c1:
                    if lit != var_to_eliminate and lit != -var_to_eliminate: r.add(lit)
                for lit in c2:
                    if lit != var_to_eliminate and lit != -var_to_eliminate: r.add(lit)

                is_tautology = any(neg_lit in r for neg_lit in (-l for l in r))
                if is_tautology: continue

                if not r: return UNSATISFIABLE_STR # Empty clause derived
                resolvents.append(r) 
        
        formula_before_res_str = ','.join(sorted(['|'.join(map(str, sorted(list(c)))) for c in formula]))

        unique_resolvents_list: CnfFormula = []
        seen_resolvents_str = set()
        for res_clause in resolvents:
            res_str = ','.join(map(str, sorted(list(res_clause))))
            if res_str not in seen_resolvents_str:
                unique_resolvents_list.append(res_clause)
                seen_resolvents_str.add(res_str)

        next_formula_source = other_clauses + unique_resolvents_list
        
        final_next_formula: CnfFormula = []
        seen_clauses_str = set()
        for cl_set in next_formula_source:
            cl_str = ','.join(map(str, sorted(list(cl_set))))
            if cl_str not in seen_clauses_str:
                final_next_formula.append(cl_set) 
                seen_clauses_str.add(cl_str)
        
        formula = final_next_formula
        formula_after_res_str = ','.join(sorted(['|'.join(map(str, sorted(list(c)))) for c in formula]))
        
        if formula_before_res_str == formula_after_res_str and clauses_with_p and clauses_with_not_p:
            return SATISFIABLE_STR
        
        last_formula_str_state = formula_after_res_str 

        if not formula: return SATISFIABLE_STR 
    
    return DP_MAX_ITERATIONS_REACHED



if __name__ == '__main__':
    if not os.path.exists("data"):
        os.makedirs("data")

    test_file_sat_path = "data/test_dp_sat.cnf"
    test_file_unsat_path = "data/test_dp_unsat.cnf"

    with open(test_file_sat_path, "w") as f:
        f.write("c Test SAT for DP\n")
        f.write("p cnf 2 2\n")
        f.write("1 -2 0\n")
        f.write("-1 2 0\n")

    with open(test_file_unsat_path, "w") as f:
        f.write("c Test UNSAT for DP\n")
        f.write("p cnf 1 2\n")
        f.write("1 0\n")
        f.write("-1 0\n")

    print("Testing DP Solver...")

    parsed_sat = parse_dimacs(test_file_sat_path)
    if parsed_sat:
        formula_sat, num_vars_sat, _ = parsed_sat
        print(f"\nSolving SAT file: {test_file_sat_path}")
        result_sat = dp_solver(formula_sat, num_vars_sat)
        print(f"DP Result for SAT file: {result_sat}")
    else:
        print(f"Failed to parse {test_file_sat_path}")

    parsed_unsat = parse_dimacs(test_file_unsat_path)
    if parsed_unsat:
        formula_unsat, num_vars_unsat, _ = parsed_unsat
        print(f"\nSolving UNSAT file: {test_file_unsat_path}")
        result_unsat = dp_solver(formula_unsat, num_vars_unsat)
        print(f"DP Result for UNSAT file: {result_unsat}")
    else:
        print(f"Failed to parse {test_file_unsat_path}")
 