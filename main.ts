import { Literal, Clause, CnfFormula, Assignment } from "./types"; 
import { readFileSync, writeFileSync } from "fs";


function parseDIMACS(filePath: string): { formula: CnfFormula; numVariables: number; numClausesHeader: number } | null {
    const data = readFileSync(filePath, "utf-8");
    const lines = data.split('\n');

    let numVariables: number = 0;
    let numClausesHeader: number = 0;
    let headerFound = false;
    const parsedFormula: CnfFormula = [];
    let lineIndex = 0;

    // Find header line (p cnf ...)
    while (lineIndex < lines.length) {
        const line = lines[lineIndex].trim();
        lineIndex++;

        if (line.startsWith('c') || line.startsWith('%') || line === '') {
            continue; // Skip comment lines, percent-start lines, and empty lines
        }

        if (line.startsWith('p cnf')) {
            const headerParts = line.split(/\s+/);
            if (headerParts.length < 4) {
                console.error(`Error: Invalid p cnf header line: "${line}"`);
                return null;
            }
            numVariables = parseInt(headerParts[2], 10);
            numClausesHeader = parseInt(headerParts[3], 10);

            if (isNaN(numVariables) || isNaN(numClausesHeader)) {
                console.error(`Error: Could not parse numbers in 'p cnf' header: "${line}"`);
                return null;
            }
            headerFound = true;
            console.log("Header:", line);
            console.log("Variables:", numVariables, "Clauses:", numClausesHeader, '\n');
            break; // Found header, move to parsing clauses
        } else {
            // Found non-comment, non-empty line before header
            console.error(`Error: Unexpected line before p cnf header: "${line}"`);
            return null;
        }
    }

    if (!headerFound) {
        console.error("Error: p cnf header line not found.");
        return null;
    }

    // Parse clause lines
    while (lineIndex < lines.length) {
        const line = lines[lineIndex].trim();
        lineIndex++;

        if (line.startsWith('c') || line.startsWith('%') || line === '') {
            continue; // Skip comment lines, percent-start lines, and empty lines
        }

        const literalStrings = line.split(/\s+/).filter(s => s.length > 0);
        const clause: Clause = new Set<Literal>();
        let clauseEnded = false;

        for (const litStr of literalStrings) {
            const literal = parseInt(litStr, 10);

            if (isNaN(literal)) {
                console.error(`Error: Non-integer literal "${litStr}" found in line: "${line}". Please check the input file.`);
                // Skipping this clause, error in input file
                clause.clear();
                clauseEnded = true; // Mark as ended to prevent adding partial clause
                break;
            }

            if (literal === 0) {
                clauseEnded = true;
                break; // End of clause 
            }
            clause.add(literal);
        }

        // Check if a non-empty line didn't end properly with 0
        if (!clauseEnded && literalStrings.length > 0) {
            console.warn(`Warning: Clause line did not end with 0: "${line}". Please check the input file.`);
            // Warning, clause not ended properly
        }

        if (clause.size > 0) {
            parsedFormula.push(clause);
        }
    }

    // Counting clauses
    if (parsedFormula.length !== numClausesHeader) {
        console.warn(`Warning: Header specified ${numClausesHeader} clauses, but ${parsedFormula.length} were parsed. Please check the input file.`);
    }

    return { formula: parsedFormula, numVariables, numClausesHeader };
}


function simplifyFormula(formula: CnfFormula, trueLiteral: Literal): CnfFormula | 'CONFLICT' {
    const simplifiedFormula: CnfFormula = [];
    const negativeLiteral = -trueLiteral;

    for (const clause of formula) {
        // If a clause is already empty from a previous step, the formula is unsatisfiable.
        if (clause.size === 0) {
            return 'CONFLICT';
        }

        // If the clause contains the literal we are setting to true,
        // the clause is satisfied and can be removed from the simplified formula.
        if (clause.has(trueLiteral)) {
                continue;
        }

        // If the clause contains the negation of the literal we are setting to true,
        // that negated literal must be removed. This might make the clause empty (conflict)
        // or just smaller.
        if (clause.has(negativeLiteral)) {
            const newClause: Clause = new Set<Literal>();
            for (const literal of clause) {
                if (literal !== negativeLiteral) {
                    newClause.add(literal);
                }
            }
            // If removing the negativeLiteral made the clause empty, it's a conflict.
            if (newClause.size === 0) {
            return 'CONFLICT';
        }
            simplifiedFormula.push(newClause);
        } else {
            // The clause does not contain trueLiteral (checked above) and does not contain negativeLiteral.
            // Therefore, this clause is not affected by the assignment of trueLiteral.
            // We can reuse the original clause object (which is a set).
            simplifiedFormula.push(clause);
        }
    }

    return simplifiedFormula;
}

function applyUnitPropagation(
    formula: CnfFormula,
    assignment: Assignment
): { updatedFormula: CnfFormula | 'CONFLICT'; updatedAssignment: Assignment } {
    let currentFormula: CnfFormula | 'CONFLICT' = formula.map(clause => new Set(clause));
    let currentAssignment = new Map(assignment); // Copy assignment

    let unitClauseFound = true; // Flag to control the loop

    // Loop as long as we find and process unit clauses
    while (unitClauseFound) {
        // @ts-ignore
        if (currentFormula === 'CONFLICT') {
            break; // Safety check
        }

        unitClauseFound = false; // Reset flag for this pass
        let unitLiteral: Literal | null = null;

        // Find the first unit clause whose variable is unassigned
        for (const clause of currentFormula as CnfFormula) { // Cast needed as currentFormula can be 'CONFLICT' theoretically here
            if (clause.size === 1) {
                const literal = clause.values().next().value as Literal;
                const variable = Math.abs(literal);
                if (!currentAssignment.has(variable)) {
                    unitLiteral = literal;
                    unitClauseFound = true; // Found one, mark to process and probably loop again
                    break; // Process this unit clause
                }
                // Check for immediate conflict with existing assignment
                else if ((literal > 0 && !currentAssignment.get(variable)) || (literal < 0 && currentAssignment.get(variable))) {
                    return { updatedFormula: 'CONFLICT', updatedAssignment: currentAssignment };
                }
                // If assigned correctly, clause is satisfied, continue search
            }
        }

        // If we found an unassigned unit literal in the loop above
        if (unitLiteral != null) {
            const variable = Math.abs(unitLiteral);
            const value = unitLiteral > 0;

            // Add to assignment
            currentAssignment.set(variable, value);

            // Simplify the formula based on the unit literal being true
            // We know currentFormula is not 'CONFLICT' here because of the check at the start of the loop
            const simplificationResult = simplifyFormula(currentFormula as CnfFormula, unitLiteral);

            if (simplificationResult === 'CONFLICT') {
                // Conflict detected during simplification
                return { updatedFormula: 'CONFLICT', updatedAssignment: currentAssignment };
            } else {
                // Update formula and continue the while loop (unitClauseFound is true)
                currentFormula = simplificationResult;
            }
        }
        // If unitLiteral is null, no unassigned unit clause was found in this pass.
        // unitClauseFound remains false, so the while loop will terminate.

    } // End while loop

    // Return the final state after propagation stops
    return { updatedFormula: currentFormula, updatedAssignment: currentAssignment };
}

function applyPureLiteralRule(
    formula: CnfFormula,
    assignment: Assignment,
    numVariables: number
): { updatedFormula: CnfFormula | 'CONFLICT'; updatedAssignment: Assignment } {
    let currentFormula: CnfFormula | 'CONFLICT' = formula.map(clause => new Set(clause));
    let currentAssignment = new Map(assignment);
    let changedInIteration = true;

    while (changedInIteration) {
        if (typeof currentFormula === 'string') {
            break;
        } else {
            // currentFormula is CnfFormula
            if (currentFormula.length === 0) {
                break;
            }
            changedInIteration = false;

            const literalPolarity = new Map<number, { positive: boolean, negative: boolean }>();

            // Determine polarity of all unassigned variables in the current formula
            for (const clause of currentFormula) { // currentFormula is CnfFormula here
                for (const literal of clause) {
                    const variable = Math.abs(literal);
                    if (!currentAssignment.has(variable)) { // Only consider unassigned variables
                        if (!literalPolarity.has(variable)) {
                            literalPolarity.set(variable, { positive: false, negative: false });
                        }
                        const polarity = literalPolarity.get(variable)!;
                        if (literal > 0) {
                            polarity.positive = true;
                        } else {
                            polarity.negative = true;
                        }
                    }
                }
            }

            let pureLiteralFoundThisPass = false;
            for (let variable = 1; variable <= numVariables; variable++) {
                if (currentAssignment.has(variable)) continue; // Already assigned

                const polarity = literalPolarity.get(variable);
                if (polarity) {
                    let pureLiteralValue: Literal | null = null; // Renamed to avoid conflict
                    if (polarity.positive && !polarity.negative) {
                        pureLiteralValue = variable; // Pure positive
                    }
                    if (!polarity.positive && polarity.negative) {
                        pureLiteralValue = -variable; // Pure negative
                    }

                    if (pureLiteralValue !== null) {
                        const varToAssign = Math.abs(pureLiteralValue);
                        const valueToAssign = pureLiteralValue > 0;

                        if (!currentAssignment.has(varToAssign)) {
                            currentAssignment.set(varToAssign, valueToAssign);
                            // currentFormula is CnfFormula here
                            const simplificationResult = simplifyFormula(currentFormula, pureLiteralValue);

                            if (simplificationResult === 'CONFLICT') {
                                currentFormula = 'CONFLICT'; // Update currentFormula
                                break; // Break from inner for-loop (variables)
                            }
                            currentFormula = simplificationResult;
                            changedInIteration = true;
                            pureLiteralFoundThisPass = true;
                            break; // Break from inner for-loop (variables) to re-evaluate formula
                        }
                    }
                }
            }
            if (currentFormula === 'CONFLICT') break; // if conflict arose from simplification
            if (pureLiteralFoundThisPass) continue; // Restart while loop if a pure literal was processed
        }
    } // End while changedInIteration

    return { updatedFormula: currentFormula, updatedAssignment: currentAssignment };
}

// Renamed and signature updated to match heuristic type
function selectVariable_FirstAvailable(
    formula: CnfFormula, // Added formula, though not used by this specific heuristic
    assignment: Assignment,
    numVariables: number
): number | null {
    for (let i = 1; i <= numVariables; i++) {
        if (!assignment.has(i)) {
            return i; // Return the first unassigned variable found
        }
    }
    return null; // All variables are assigned
}

function selectVariable_Random(
    formula: CnfFormula,
    assignment: Assignment,
    numVariables: number
): number | null {
    const unassignedVariables: number[] = [];
    for (let i = 1; i <= numVariables; i++) {
        if (!assignment.has(i)) {
            unassignedVariables.push(i);
        }
    }
    if (unassignedVariables.length === 0) {
        return null;
    }
    const randomIndex = Math.floor(Math.random() * unassignedVariables.length);
    return unassignedVariables[randomIndex];
}

function selectVariable_MOMS( // Maximum Occurrences in clauses of Minimum Size
    formula: CnfFormula,
    assignment: Assignment,
    numVariables: number
): number | null {
    let minClauseSize = Infinity;
    if (formula.length === 0) return selectVariable_FirstAvailable(formula, assignment, numVariables); // Fallback or handle as needed

    // Find the size of the smallest clauses containing unassigned literals
    for (const clause of formula) {
        let unassignedLiteralsInClause = 0;
        for (const literal of clause) {
            if (!assignment.has(Math.abs(literal))) {
                unassignedLiteralsInClause++;
            }
        }
        if (unassignedLiteralsInClause > 0) {
            minClauseSize = Math.min(minClauseSize, unassignedLiteralsInClause);
        }
    }

    if (minClauseSize === Infinity) { // All remaining clauses are empty or satisfied by assigned vars, or no clauses left.
        return selectVariable_FirstAvailable(formula, assignment, numVariables); // Give up and choose any unassigned variable
    }

    const literalCountsInMinClauses = new Map<number, number>();
    let maxCount = 0;
    let bestVariable: number | null = null;

    for (const clause of formula) {
        let unassignedLiteralsInClause = 0;
        const tempClauseUnassignedLiterals: Literal[] = [];
        for (const literal of clause) {
            if (!assignment.has(Math.abs(literal))) {
                unassignedLiteralsInClause++;
                tempClauseUnassignedLiterals.push(literal);
            }
        }

        if (unassignedLiteralsInClause === minClauseSize) {
            for (const literal of tempClauseUnassignedLiterals) {
                const variable = Math.abs(literal);
                const count = (literalCountsInMinClauses.get(variable) || 0) + 1;
                literalCountsInMinClauses.set(variable, count);
                if (count > maxCount) {
                    maxCount = count;
                    bestVariable = variable;
                }
            }
        }
    }

    if (bestVariable !== null) {
        return bestVariable;
    }

    // Fallback if no variable found by MOMS (e.g., formula became empty or only unit/empty clauses handled by UP/PLE)
    return selectVariable_FirstAvailable(formula, assignment, numVariables);
}

/**
 * The main DPLL algorithm function (recursive).
 * @param formula The current CNF formula.
 * @param assignment The current assignment map.
 * @param numVariables The total number of variables in the original problem.
 * @param selectVariableHeuristic Function to select the next variable to branch on.
 * @param decisionCounter Counter for counting decisions
 * @returns An object indicating satisfiability and the satisfying assignment if found.
 */
function dpll(
    formula: CnfFormula,
    assignment: Assignment,
    numVariables: number,
    selectVariableHeuristic: (formula: CnfFormula, assignment: Assignment, numVariables: number) => number | null,
    decisionCounter: { count: number } // Added for counting decisions
): { satisfiable: boolean; assignment?: Assignment } {
    // Quick check: If formula is empty, it's satisfiable regardless of assignment
    if (formula.length === 0) {
        const completeAssignment = new Map(assignment);
        for (let i = 1; i <= numVariables; i++) {
            if (!completeAssignment.has(i)) {
                completeAssignment.set(i, false); 
            }
        }
        return { satisfiable: true, assignment: completeAssignment };
    }

    for (const clause of formula) {
        if (clause.size === 0) {
            return { satisfiable: false }; 
        }
    }

    let { updatedFormula, updatedAssignment } = applyUnitPropagation(formula, assignment);

    if (updatedFormula === 'CONFLICT') {
        return { satisfiable: false };
    }
    
    if (updatedFormula.length === 0) {
        const completeAssignment = new Map(updatedAssignment);
        for (let i = 1; i <= numVariables; i++) {
            if (!completeAssignment.has(i)) {
                completeAssignment.set(i, false);
            }
        }
        return { satisfiable: true, assignment: completeAssignment };
    }

    const pleResult = applyPureLiteralRule(updatedFormula, updatedAssignment, numVariables);
    updatedFormula = pleResult.updatedFormula;
    updatedAssignment = pleResult.updatedAssignment;

    if (updatedFormula === 'CONFLICT') {
        return { satisfiable: false };
    }
    
    if (updatedFormula.length === 0) {
        const completeAssignment = new Map(updatedAssignment);
        for (let i = 1; i <= numVariables; i++) {
            if (!completeAssignment.has(i)) {
                completeAssignment.set(i, false);
            }
        }
        return { satisfiable: true, assignment: completeAssignment };
    }

    const variableToAssign = selectVariableHeuristic(updatedFormula, updatedAssignment, numVariables);

    if (variableToAssign === null) {
        // All variables assigned, but formula not empty and not conflict.
        // This implies the current full assignment doesn't satisfy the formula.
        return { satisfiable: false };
    }
    decisionCounter.count++; // Increment decision counter

    for (const value of [true, false]) {
        const branchAssignment = new Map(updatedAssignment);
        branchAssignment.set(variableToAssign, value);
        
        const literal = value ? variableToAssign : -variableToAssign;
        // Directly simplify the formula for the recursive call
        const simplifiedFormulaBranch = simplifyFormula(updatedFormula, literal); 
        
        if (simplifiedFormulaBranch === 'CONFLICT') {
            continue; 
        }
        
        const result = dpll(
            simplifiedFormulaBranch, 
            branchAssignment, 
            numVariables, 
            selectVariableHeuristic,
            decisionCounter // Pass counter through
        );
        
        if (result.satisfiable) {
            return result; 
        }
    }
    
    return { satisfiable: false };
}

// --- Top-Level Solver Interface ---
type HeuristicFunction = (formula: CnfFormula, assignment: Assignment, numVariables: number) => number | null;

interface SolverResult {
    filePath: string;
    heuristicName: string;
    status: 'SATISFIABLE' | 'UNSATISFIABLE' | 'PARSING_FAILED' | 'HEURISTIC_NOT_FOUND' | 'EMPTY_FORMULA_SAT' | 'DP_CLAUSE_LIMIT' | 'DP_MAX_ITERATIONS' | 'MAX_ITERATIONS_REACHED';
    timeMs: number;
    decisions: number;
    assignment?: Assignment;
}

const heuristics: Record<string, HeuristicFunction | string> = {
    'dp': 'dp_solver_placeholder', // Will use a string to signify DP
    'first': selectVariable_FirstAvailable,
    'random': selectVariable_Random,
    'moms': selectVariable_MOMS,
    'resolution': 'resolution_solver_placeholder' // Placeholder for pure resolution
};

const MAX_CLAUSES_DP = 5000; // Safety limit

function runSolver(filePath: string, heuristicKey: string): SolverResult {
    const decisionCounter = { count: 0 }; // For DPLL, DP/Resolution decisions are not counted this way
    const startTime = performance.now();

    const parseResult = parseDIMACS(filePath);
    if (!parseResult) {
        return {
            filePath,
            heuristicName: heuristicKey,
            status: 'PARSING_FAILED',
            timeMs: parseFloat((performance.now() - startTime).toFixed(2)),
            decisions: 0
        };
    }

    const { formula, numVariables } = parseResult;

    if (formula.length === 0) { // Handle cases with empty formulas
        return {
            filePath,
            heuristicName: heuristicKey,
            status: 'EMPTY_FORMULA_SAT',
            timeMs: parseFloat((performance.now() - startTime).toFixed(2)),
            decisions: 0,
            assignment: numVariables > 0 ? new Map(Array.from({ length: numVariables }, (_, i) => [i + 1, true])) : new Map()
        };
    }
    
    let dpllRunResult: { satisfiable: boolean; assignment?: Assignment };
    let dpRunResult: { satisfiable: boolean; assignment?: undefined; status?: 'CLAUSE_LIMIT_REACHED' | 'MAX_ITERATIONS_REACHED' };
    let resolutionRunResult: { satisfiable: boolean; status?: 'MAX_ITERATIONS_REACHED' }; // Added for resolution
    let finalStatus: SolverResult['status'];
    let finalAssignment: Assignment | undefined = undefined;
    let actualHeuristicName = heuristicKey;

    if (heuristicKey === 'dp') {
        actualHeuristicName = 'DP';
        dpRunResult = dpSolver(formula, numVariables);
        decisionCounter.count = 0; 
        if (dpRunResult.status === 'CLAUSE_LIMIT_REACHED') {
            finalStatus = 'DP_CLAUSE_LIMIT';
        } else if (dpRunResult.status === 'MAX_ITERATIONS_REACHED') {
            finalStatus = 'DP_MAX_ITERATIONS';
        } else {
            finalStatus = dpRunResult.satisfiable ? 'SATISFIABLE' : 'UNSATISFIABLE';
        }
        // No assignment from DP
    } else if (heuristicKey === 'resolution') { // Handle resolution solver
        actualHeuristicName = 'Resolution';
        resolutionRunResult = resolutionSolver(formula);
        decisionCounter.count = 0; // Resolution doesn't use this type of decision counter
        if (resolutionRunResult.status === 'MAX_ITERATIONS_REACHED') {
            finalStatus = 'MAX_ITERATIONS_REACHED';
        } else {
            finalStatus = resolutionRunResult.satisfiable ? 'SATISFIABLE' : 'UNSATISFIABLE';
        }
        // No direct assignment from this pure resolution solver
    } else {
        const selectedHeuristic = heuristics[heuristicKey.toLowerCase()] as HeuristicFunction;
        if (!selectedHeuristic || typeof selectedHeuristic !== 'function') {
            return { 
                filePath,
                heuristicName: heuristicKey,
                status: 'HEURISTIC_NOT_FOUND',
                timeMs: parseFloat((performance.now() - startTime).toFixed(2)),
                decisions: 0
            };
        }
        actualHeuristicName = heuristicKey.charAt(0).toUpperCase() + heuristicKey.slice(1); // Capitalize for display
        dpllRunResult = dpll(
            formula,
            new Map<number, boolean>(),
            numVariables,
            selectedHeuristic,
            decisionCounter
        );
        finalStatus = dpllRunResult.satisfiable ? 'SATISFIABLE' : 'UNSATISFIABLE';
        finalAssignment = dpllRunResult.assignment;
    }
    
    const endTime = performance.now();
    const duration = parseFloat((endTime - startTime).toFixed(2));

    return {
        filePath,
        heuristicName: actualHeuristicName, 
        status: finalStatus,
        timeMs: duration,
        decisions: decisionCounter.count,
        assignment: finalAssignment
    };
}

// Helper function to verify a solution
function verifySolution(formula: CnfFormula, assignment: Assignment): boolean {
    for (const clause of formula) {
        let clauseSatisfied = false;
        
        for (const literal of clause) {
            const variable = Math.abs(literal);
            const value = assignment.get(variable);
            
            if (value === undefined) {
                console.error(`Error: Variable ${variable} not assigned`);
                return false;
            }
            
            // Check if this literal makes the clause true
            if ((literal > 0 && value === true) || (literal < 0 && value === false)) {
                clauseSatisfied = true;
                break;
            }
        }
        
        if (!clauseSatisfied) {
            return false; // Found an unsatisfied clause
        }
    }
    return true; // All clauses satisfied
}

// --- Davis-Putnam (DP) Algorithm Implementation ---

// Helper to get all unique variable numbers from a formula
function getVariablesInFormulaDP(formula: CnfFormula): Set<number> {
    const vars = new Set<number>();
    for (const clause of formula) {
        for (const literal of clause) {
            vars.add(Math.abs(literal));
        }
    }
    return vars;
}

// Helper to check if two formulas are semantically the same (order of clauses/literals doesn't matter)
function areFormulasSemanticallySame(f1: CnfFormula, f2: CnfFormula): boolean {
    if (f1.length !== f2.length) return false;
    const f1ClauseStrings = new Set(f1.map(c => Array.from(c).sort((a, b) => a - b).join(',')));
    for (const clause of f2) {
        if (!f1ClauseStrings.has(Array.from(clause).sort((a, b) => a - b).join(','))) {
            return false;
        }
    }
    return true;
}


// DP-specific Unit Propagation
function applyDPUnitPropagation(inputFormula: CnfFormula): { formula: CnfFormula | 'CONFLICT'; changed: boolean } {
    let formulaToProcess = inputFormula.map(c => new Set(c)); // Start with a CnfFormula
    let overallChanged = false;
    let iterationChanged = true;

    while (iterationChanged) {
        iterationChanged = false;

        if (formulaToProcess.length === 0) return { formula: formulaToProcess, changed: overallChanged };
        if (formulaToProcess.some(c => c.size === 0)) return { formula: 'CONFLICT', changed: true };

        let unitLiteral: Literal | null = null;
        for (const clause of formulaToProcess) {
            if (clause.size === 1) {
                unitLiteral = clause.values().next().value as Literal;
                break;
            }
        }

        if (unitLiteral !== null) {
            const formulaBeforeSimplification = formulaToProcess.map(c => new Set(c));
            const simplifiedResult = simplifyFormula(formulaToProcess, unitLiteral);

            if (simplifiedResult === 'CONFLICT') {
                return { formula: 'CONFLICT', changed: true }; // Immediate return on CONFLICT
            }
            
            // At this point, simplifiedResult is CnfFormula
            if (!areFormulasSemanticallySame(formulaBeforeSimplification, simplifiedResult)) {
                overallChanged = true;
                iterationChanged = true;
            }
            formulaToProcess = simplifiedResult; // Assign the CnfFormula back
            } else {
            iterationChanged = false; 
        }
    }
    return { formula: formulaToProcess, changed: overallChanged };
}

// DP-specific Pure Literal Elimination
function applyDPPureLiteralElimination(inputFormula: CnfFormula): { formula: CnfFormula | 'CONFLICT'; changed: boolean } {
    let formulaToProcess = inputFormula.map(c => new Set(c)); // Start with a CnfFormula
    let overallChanged = false;
    let iterationChanged = true;

    while (iterationChanged) {
        iterationChanged = false;

        if (formulaToProcess.length === 0) return { formula: formulaToProcess, changed: overallChanged };
        if (formulaToProcess.some(c => c.size === 0)) return { formula: 'CONFLICT', changed: true };

        const literalPolarity = new Map<number, { p: boolean; n: boolean }>();
        const varsInFormula = getVariablesInFormulaDP(formulaToProcess);

        for (const clause of formulaToProcess) { 
            for (const literal of clause) {
                const variable = Math.abs(literal);
                if (!literalPolarity.has(variable)) literalPolarity.set(variable, { p: false, n: false });
                literal > 0 ? literalPolarity.get(variable)!.p = true : literalPolarity.get(variable)!.n = true;
            }
        }

        let pureLiteralToAssign: Literal | null = null;
        for (const variable of Array.from(varsInFormula).sort((a, b) => a - b)) {
            const pol = literalPolarity.get(variable);
            if (pol) {
                if (pol.p && !pol.n) { pureLiteralToAssign = variable; break; }
                if (!pol.p && pol.n) { pureLiteralToAssign = -variable; break; }
            }
        }

        if (pureLiteralToAssign !== null) {
            const formulaBeforeSimplification = formulaToProcess.map(c => new Set(c));
            const simplifiedResult = simplifyFormula(formulaToProcess, pureLiteralToAssign);
            if (simplifiedResult === 'CONFLICT') {
                 return { formula: 'CONFLICT', changed: true }; // Immediate return on CONFLICT
            }
            // At this point, simplifiedResult is CnfFormula
            if (!areFormulasSemanticallySame(formulaBeforeSimplification, simplifiedResult)) {
                overallChanged = true;
                iterationChanged = true;
            }
            formulaToProcess = simplifiedResult; // Assign the CnfFormula back
        } else {
            iterationChanged = false;
        }
    }
    return { formula: formulaToProcess, changed: overallChanged };
}

function dpSolver(
    initialFormula: CnfFormula,
    _numVariables: number // Not strictly used by this DP variant beyond initial context
): { satisfiable: boolean; assignment?: undefined; status?: 'CLAUSE_LIMIT_REACHED' | 'MAX_ITERATIONS_REACHED' } { 
    let formula = initialFormula.map(clause => new Set(clause));
    let lastFormulaStringState = ""; 

    const initialVarCount = getVariablesInFormulaDP(formula).size;
    const maxIterations = initialVarCount > 0 ? initialVarCount + 10 : 20; // Increased max iterations slightly
    // console.log(`DP Solver: Starting with ${formula.length} clauses, ${initialVarCount} variables. Max iterations: ${maxIterations}`);

    for (let iter = 0; iter < maxIterations; iter++) {
        // console.log(`DP Iteration ${iter + 1}, Clauses: ${formula.length}`);
        if (formula.length > MAX_CLAUSES_DP) {
            console.warn(`DP Solver: Exceeded MAX_CLAUSES_DP (${MAX_CLAUSES_DP}). Aborting.`);
            return { satisfiable: false, status: 'CLAUSE_LIMIT_REACHED' };
        }

        // --- 1. Simplification Phase (UP & PLE to fixpoint) ---
        let changedInSimplificationLoop;
        do {
            changedInSimplificationLoop = false;

            if (formula.length === 0) return { satisfiable: true };
            if (formula.some(c => c.size === 0)) return { satisfiable: false };

            const upResult = applyDPUnitPropagation(formula);
            if (upResult.formula === 'CONFLICT') return { satisfiable: false };
            if (upResult.changed) {
                formula = upResult.formula as CnfFormula; // Cast because 'CONFLICT' is handled
                changedInSimplificationLoop = true;
                continue; 
            }
            formula = upResult.formula as CnfFormula;

            const pleResult = applyDPPureLiteralElimination(formula);
            if (pleResult.formula === 'CONFLICT') return { satisfiable: false };
            if (pleResult.changed) {
                formula = pleResult.formula as CnfFormula;
                changedInSimplificationLoop = true;
    } else {
                formula = pleResult.formula as CnfFormula;
            }
        } while (changedInSimplificationLoop);

        // --- Post-Simplification Checks ---
        if (formula.length === 0) return { satisfiable: true };
        if (formula.some(c => c.size === 0)) return { satisfiable: false };

        // --- 2. Resolution Phase ---
        const varsInFormula = Array.from(getVariablesInFormulaDP(formula)).sort((a, b) => a - b);
        
        if (varsInFormula.length === 0) { // No variables left
            return { satisfiable: formula.length === 0 }; // True if formula is empty, false otherwise (e.g. [[]])
        }

        const varToEliminate = varsInFormula[0]; // Simplest strategy: pick smallest variable

        const clausesWithP: CnfFormula = [];
        const clausesWithNotP: CnfFormula = [];
        const otherClauses: CnfFormula = [];

        formula.forEach(clause => {
            if (clause.has(varToEliminate)) clausesWithP.push(clause);
            else if (clause.has(-varToEliminate)) clausesWithNotP.push(clause);
            else otherClauses.push(clause);
        });

        // If varToEliminate is effectively pure at this stage (only P or only notP clauses)
        // Resolution won't generate new clauses *from it*.
        // The simplification loop should have handled true pures. If it's pure here,
        // it means it can't be used for resolution to eliminate itself further through combination.
        // The formula for the next step is simply otherClauses + clauses containing varToEliminate.
        // The variable will be absent in `varsInFormula` in the next iteration if it was the only one.
        if (clausesWithP.length === 0 || clausesWithNotP.length === 0) {
            // No new resolvents from this variable. The formula effectively passes through this step.
            // The variable varToEliminate is removed from consideration in the next iteration by
            // rebuilding varsInFormula from the (unchanged by resolution) current formula.
            // If the formula state doesn't change across a full outer loop, we detect stalemate.
            // This also means the set of variables to pick from might shrink.
             const currentFormulaString = formula.map(c => Array.from(c).sort((a,b)=>a-b).join(',')).sort().join('|');
             if (lastFormulaStringState === currentFormulaString) {
                // Stalemate: simplifications and resolution on this var didn't change formula.
                // If no empty clause, implies SAT.
                return { satisfiable: true };
             }
             lastFormulaStringState = currentFormulaString;
             continue; // Skip to next iteration of the main loop, will re-simplify and pick next var
        }

        const resolvents: CnfFormula = [];
        for (const c1 of clausesWithP) {
            for (const c2 of clausesWithNotP) {
                const r = new Set<Literal>();
                // Add all literals from c1 except varToEliminate
                c1.forEach(l => { if (l !== varToEliminate && l !== -varToEliminate) r.add(l); });
                // Add all literals from c2 except varToEliminate and -varToEliminate
                c2.forEach(l => { if (l !== varToEliminate && l !== -varToEliminate) r.add(l); });
                
                let isTaut = false;
                for (const lit of r) { if (r.has(-lit)) { isTaut = true; break; } }
                if (isTaut) continue;

                if (r.size === 0) return { satisfiable: false }; // UNSAT
                resolvents.push(r);
            }
        }
        
        const formulaBeforeResolutionStr = formula.map(c => Array.from(c).sort((a,b)=>a-b).join(',')).sort().join('|');

        const nextFormulaSource = [...otherClauses, ...resolvents];
        const nextFormulaUnique: CnfFormula = [];
        const seenClauses = new Set<string>();
        for (const clause of nextFormulaSource) {
            // Canonical representation for duplicate checking
            const canonical = Array.from(clause).sort((a, b) => Math.abs(a) - Math.abs(b) || a - b).join(',');
            if (!seenClauses.has(canonical)) {
                seenClauses.add(canonical);
                nextFormulaUnique.push(clause);
            }
        }
        formula = nextFormulaUnique;
        const formulaAfterResolutionStr = formula.map(c => Array.from(c).sort((a,b)=>a-b).join(',')).sort().join('|');

        // Stalemate check: if formula didn't change after resolution (and var wasn't pure for res)
        if (formulaBeforeResolutionStr === formulaAfterResolutionStr && clausesWithP.length > 0 && clausesWithNotP.length > 0) {
            // console.log("DP Stalemate after resolution, implies SAT");
            return { satisfiable: true };
        }
        lastFormulaStringState = formulaAfterResolutionStr;

        if (formula.length === 0) return { satisfiable: true };

        if (iter % 100 === 0) { // Log every 100 iterations
            console.log(`Resolution Iteration: ${iter}, Active Clauses: ${formula.length}, New Resolvents in Batch: ${resolvents.length}`);
        }
    }

    // console.warn("DP Solver exceeded max iterations. Returning UNSAT as a fallback.");
    return { satisfiable: false, status: 'MAX_ITERATIONS_REACHED' }; 
}

// --- End of DP Algorithm Implementation ---


// --- Benchmark Harness ---
async function runBenchmarkHarness(benchmarkFiles: string[], heuristicNames: string[], dpEligibleFiles: Set<string>): Promise<void> {
    // console.log("\n--- Starting Benchmark Harness ---"); // Header removed as per request
    const allResults: SolverResult[] = [];
    let firstFileProcessed = false;

    for (const filePath of benchmarkFiles) {
        if (firstFileProcessed) {
            console.log("\n-------------------------------------"); // Separator between files
        }
        console.log(`Processing file: ${filePath}`);
        firstFileProcessed = true;

        for (const heuristicName of heuristicNames) {
            // Check if DP should run on this file
            if (heuristicName === 'dp' && !dpEligibleFiles.has(filePath)) {
                console.log(`  [ ] Heuristic: DP          | Status: SKIPPED (not in dp list)`);
                continue; // Skip DP for this file
            }

            // Check if Resolution should run on this file (only for files eligible for DP)
            if (heuristicName === 'resolution' && !dpEligibleFiles.has(filePath)) {
                console.log(`  [ ] Heuristic: Resolution  | Status: SKIPPED (not in dp list for resolution)`);
                continue; // Skip Resolution for this file
            }

            // process.stdout.write(`  Running with heuristic '${heuristicName}'... `);
            const result = runSolver(filePath, heuristicName);
            allResults.push(result);
            
            let statusIndicator = " ";
            if (result.status === 'SATISFIABLE') statusIndicator = "✓";
            else if (result.status === 'UNSATISFIABLE') statusIndicator = "✗";
            else if (result.status === 'EMPTY_FORMULA_SAT') statusIndicator = "✓";
            else statusIndicator = "!";

            const heuristicFormatted = heuristicName.padEnd(10);
            let logMessage = `  [${statusIndicator}] Heuristic: ${heuristicFormatted} | Status: ${result.status.padEnd(17)}`;
            if (result.status === 'SATISFIABLE' || result.status === 'UNSATISFIABLE' || result.status === 'EMPTY_FORMULA_SAT') {
                logMessage += ` | Time: ${String(result.timeMs).padStart(7)}ms | Decisions: ${String(result.decisions).padStart(7)}`;
} else {
                logMessage += ` | Time: ${String(result.timeMs).padStart(7)}ms`;
            }
            console.log(logMessage);
        }
    }

    console.log("\n--- Benchmark Summary ---");
    console.log("================================================================================");
    console.log("| File                 | Heuristic | Status            | Time (ms) | Decisions |");
    console.log("|----------------------|-----------|-------------------|-----------|-----------|");

    allResults.forEach(res => {
        const fileNameFormatted = res.filePath.length > 20 ? "..." + res.filePath.slice(-17) : res.filePath.padEnd(20);
        const heuristicFormattedTable = res.heuristicName.padEnd(9);
        const statusFormatted = res.status.padEnd(17);
        const timeFormatted = String(res.timeMs).padStart(9);
        const decisionsFormatted = String(res.decisions).padStart(9);
        
        // Assignment preview removed
        // let assignmentPreview = "-";
        // if (res.assignment && res.assignment.size > 0) {
        //     assignmentPreview = Array.from(res.assignment.entries()).slice(0, 5).map(([k, v]) => `${k}:${v ? 'T' : 'F'}`).join(',');
        //     if (res.assignment.size > 5) assignmentPreview += "...";
        // }
        // const assignmentFormatted = assignmentPreview.padEnd(20);

        console.log(`| ${fileNameFormatted} | ${heuristicFormattedTable} | ${statusFormatted} | ${timeFormatted} | ${decisionsFormatted} |`);
    });
    console.log("================================================================================");
    console.log("\n--- Benchmark Detailed Results ---");

    // Optional: Write to CSV
    writeResultsToCSV(allResults, 'benchmark_results.csv');
}



function writeResultsToCSV(results: SolverResult[], csvFilePath: string): void {
    if (results.length === 0) {
        console.log("No results to write to CSV.");
        return;
    }
    // Define the header row
    const header = ["File", "Heuristic", "Status", "Time(miliseconds)", "Decisions"].join(",");

    // Map each result object to a CSV row string
    const rows = results.map(res => {
        // Make assignment string more CSV-friendly: var:val;var:val
        let assignmentStr = "-";
        if (res.assignment && res.assignment.size > 0) {
            assignmentStr = Array.from(res.assignment.entries())
                .map(([k, v]) => `${k}:${v ? 'T' : 'F'}`)
                .join(";"); // Semicolon-separated pairs
        }
        
        // Escape double quotes in string fields if any, and enclose in double quotes
        const filePathFormatted = `"${res.filePath.replace(/"/g, '""')}"`;
        const assignmentFormatted = `"${assignmentStr.replace(/"/g, '""')}"`;

        return [
            filePathFormatted,
            res.heuristicName,
            res.status,
            res.timeMs,
            res.decisions
        ].join(",");
    });

    // Combine header and rows, ensuring each is on a new line
    const csvContent = [header, ...rows].join("\n");

    try {
        writeFileSync(csvFilePath, csvContent + "\n"); // Add a final newline for POSIX compatibility
        console.log(`\nBenchmark results written to ${csvFilePath}`);
    } catch (error) {
        console.error(`Error writing CSV to ${csvFilePath}:`, error);
    }
}


// --- Main execution ---

const benchmarkListDPPath = "data/benchmarks_dp.list";
const benchmarkListAllPath = "data/benchmarks_all.list"; 

function loadBenchmarkFilesFromList(listPath: string): string[] {
    try {
        const fileContent = readFileSync(listPath, "utf-8");
        const lines = fileContent.split('\n');
        const benchmarkFiles = lines
            .map(line => line.trim())
            .filter(line => line.length > 0 && !line.startsWith('#')) // Ignore empty lines and comments
            .map(fileName => `data/${fileName}`); // Prepend "data/" to each fileName

        if (benchmarkFiles.length === 0) {
            console.warn(`Warning: Benchmark list file '${listPath}' is empty or only contains comments.`);
            return [];
        }
        console.log(`Loaded ${benchmarkFiles.length} benchmark file(s) from '${listPath}'.`);
        return benchmarkFiles;
    } catch (error) {
        // Check if the error is because the file does not exist
        // @ts-ignore
        if (error.code === 'ENOENT') {
            console.warn(`Warning: Benchmark list file '${listPath}' not found. Please create it and list your .cnf files, one per line.`);
    } else {
            console.error(`Error reading benchmark list file '${listPath}':`, error);
        }
        return [];
    }
}


// Create dummy benchmark files if they don't exist for testing the harness
// This function is now simplified to mainly ensure the 'data' directory exists.
// Users should populate 'data/benchmarks.list' and the actual .cnf files.
function ensureDataDirectoryExists(): void {
    const fs = require('fs'); // Local require for this setup function
    if (!fs.existsSync("data")){
        console.log("Creating 'data' directory...");
        fs.mkdirSync("data");
    }
    
    // Create example DP list file
    const exampleDPListContent = `
# Example benchmarks_dp.list
# Add SMALL .cnf filenames for DP testing below.
# Assumes files are in the 'data/' directory.
dp_sat_1.cnf
dp_sat_2.cnf
dp_unsat_1.cnf
dp_unsat_2.cnf
`;
    if (!fs.existsSync(benchmarkListDPPath)) {
        console.log(`Creating example DP benchmark list: '${benchmarkListDPPath}'`);
        fs.writeFileSync(benchmarkListDPPath, exampleDPListContent.trim() + '\n');
        console.log(`Please edit '${benchmarkListDPPath}' to include SMALL files suitable for DP.`);
    }

    // Create example ALL list file
    const exampleAllListContent = `
# Example benchmarks_all.list
# Add ALL .cnf filenames for DPLL testing below.
# Assumes files are in the 'data/' directory.

# Small files (also run by DP)
dp_sat_1.cnf
dp_sat_2.cnf
dp_unsat_1.cnf
dp_unsat_2.cnf

# Larger files (DPLL only)
uf20-0995.cnf 
# uuf50-01.cnf
# uf100-0999.cnf 
`;
    if (!fs.existsSync(benchmarkListAllPath)) {
        console.log(`Creating example All benchmark list: '${benchmarkListAllPath}'`);
        fs.writeFileSync(benchmarkListAllPath, exampleAllListContent.trim() + '\n');
        console.log(`Please edit '${benchmarkListAllPath}' to include ALL files for DPLL testing.`);
    }
}

ensureDataDirectoryExists(); 

// Load the set of files eligible for DP runs
const dpEligibleFiles = new Set(loadBenchmarkFilesFromList(benchmarkListDPPath));

// Load the list of all files to test with DPLL
const allBenchmarkFilesToTest: string[] = loadBenchmarkFilesFromList(benchmarkListAllPath);

// The main CNF file path (filePathCNF) is no longer used for direct runs here,
// the harness uses the benchmarkFilesToTest array.
// console.log(`Using CNF file: ${filePathCNF}`); // This line is now less relevant for harness runs

// Define the heuristics to test, including resolution
const heuristicsToTest = ['dp', 'first', 'random', 'moms', 'resolution'];

if (allBenchmarkFilesToTest.length > 0) {
    runBenchmarkHarness(allBenchmarkFilesToTest, heuristicsToTest, dpEligibleFiles)
        .then(() => {
            console.log("\nSuccessfully completed all benchmark runs.");
        })
        .catch(error => {
            console.error("\nError during benchmark harness execution:", error);
        });
} else {
    console.log("\nNo benchmark files loaded. Skipping harness execution.");
    console.log(`Please create or populate '${benchmarkListAllPath}' with paths to your .cnf files.`);
}

// The global parseResult is no longer strictly necessary here if only running the harness.
// If you have other operations that rely on a single global parse, you might keep it.
// const parseResultGlobal = parseDIMACS(filePathCNF); 
// if (!parseResultGlobal) {
//     console.error(`\nError: Failed to parse the main CNF file: ${filePathCNF} for any potential post-solver operations.`);
// }

// --- Resolution Solver Implementation ---
function resolutionSolver(formula: CnfFormula): { satisfiable: boolean; status?: 'MAX_ITERATIONS_REACHED' } {
    const MAX_ITERATIONS = 100000; // Safety limit for resolution steps
    let currentFormula = formula.map(c => new Set(c)); // Deep copy
    const seenClausesInFormula = new Set<string>(); // To keep track of unique clauses ever in currentFormula

    // Initial population of seenClausesInFormula
    for (const clause of currentFormula) {
        const canonical = Array.from(clause).sort((a, b) => a - b).join(',');
        seenClausesInFormula.add(canonical);
    }
    
    let iterationCount = 0;

    while (iterationCount < MAX_ITERATIONS) {
        if (currentFormula.some(c => c.size === 0)) {
            return { satisfiable: false };
        }
        if (currentFormula.length === 0) {
            return { satisfiable: true };
        }

        const newResolventsBatch: CnfFormula = [];
        const seenNewResolventsCanonicalInBatch = new Set<string>();
        let newClauseAddedThisIteration = false;

        for (let i = 0; i < currentFormula.length; i++) {
            for (let j = i + 1; j < currentFormula.length; j++) {
                const c1 = currentFormula[i];
                const c2 = currentFormula[j];

                for (const lit1 of c1) {
                    if (c2.has(-lit1)) {
                        const resolvent = new Set<Literal>();
                        for (const l of c1) if (l !== lit1) resolvent.add(l);
                        for (const l of c2) if (l !== -lit1) resolvent.add(l);

                        let isTautology = false;
                        for (const l of resolvent) {
                            if (resolvent.has(-l)) {
                                isTautology = true;
                                break;
                            }
                        }
                        if (isTautology) continue;
                        
                        if (resolvent.size === 0) return { satisfiable: false };

                        const canonical = Array.from(resolvent).sort((a, b) => a - b).join(',');
                        if (!seenClausesInFormula.has(canonical) && !seenNewResolventsCanonicalInBatch.has(canonical)) {
                            newResolventsBatch.push(resolvent);
                            seenNewResolventsCanonicalInBatch.add(canonical);
                            newClauseAddedThisIteration = true;
                        }
                    }
                }
            }
        }

        if (!newClauseAddedThisIteration) {
            return { satisfiable: true };
        }

        for (const resolvent of newResolventsBatch) {
            currentFormula.push(resolvent);
            // The canonical form was already generated and used for seenNewResolventsCanonicalInBatch
            // We need to add it to the global seenClausesInFormula
            const canonical = Array.from(resolvent).sort((a, b) => a - b).join(','); 
            seenClausesInFormula.add(canonical);
        }
        
        if (iterationCount % 100 === 0) { // Log every 100 iterations
            console.log(`Resolution Iteration: ${iterationCount}, Active Clauses: ${currentFormula.length}, New Resolvents in Batch: ${newResolventsBatch.length}`);
        }
        iterationCount++;
    }

    return { satisfiable: false, status: 'MAX_ITERATIONS_REACHED' };
}



