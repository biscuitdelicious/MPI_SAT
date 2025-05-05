import {Literal, Clause, CnfFormula} from "./types";
import {readFileSync} from "fs";

// |= a model makes true, with a given predicate; M |= P


// // CNF: ^ intre ()


// TODO: Work on parsing DIMACS format
// TODO: Work on DPLL core

const filePathCNF = "data/test.cnf";

function parseDIMACS(filePath: string): CnfFormula {
    // TODO: Work on file handling
    const data = readFileSync(filePath, "utf-8");

    const firstNewlineIndex = data.indexOf('\n');
    let firstLine: string = data.substring(0, firstNewlineIndex).trim();

    const headerParts = firstLine.split(/\s+/);
    const variables: number = Number(headerParts[2]);
    const clauses: number = Number(headerParts[3]);
    console.log("Header:", firstLine);
    console.log("Variables:", variables, "Clauses:", clauses, '\n');

    const clausesLinesString = data.substring(firstNewlineIndex + 1).trim();
    const lines = clausesLinesString.split('\n');
    const parsedFormula: CnfFormula = [];

    for(let line of lines){
        const trimmedLine = line.trim();

        const literalStrings = trimmedLine.split(/\s+/).filter(s => s.length > 0);
        // console.log("Printing literal strings: ", literalStrings);

        const clause: Clause = new Set<Literal>();
        for(let lit of literalStrings){
            const literal = Number(lit);
            if(literal != 0) {
                clause.add(literal);
            }
        }

        if(clause.size > 0){
            parsedFormula.push(clause);
        }
    }

    return parsedFormula;
}

console.log(parseDIMACS(filePathCNF));

