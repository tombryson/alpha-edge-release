// route-manifest reads source only. It does not start the server or open a database.
package main

import (
	"bytes"
	"encoding/json"
	"flag"
	"go/ast"
	"go/format"
	"go/parser"
	"go/token"
	"os"
	"sort"
	"strconv"
)

type route struct {
	Method  string `json:"method"`
	Path    string `json:"path"`
	Handler string `json:"handler"`
	Line    int    `json:"line"`
}

func literal(expr ast.Expr) string {
	value, ok := expr.(*ast.BasicLit)
	if !ok || value.Kind != token.STRING {
		panic("non-literal route or method: extend the extractor")
	}
	text, err := strconv.Unquote(value.Value)
	if err != nil {
		panic(err)
	}
	return text
}

func main() {
	path := flag.String("source", "backend/routes.go", "router source to inspect")
	flag.Parse()
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, *path, nil, 0)
	if err != nil {
		panic(err)
	}
	var routes []route
	handled := map[*ast.CallExpr]bool{}
	ast.Inspect(file, func(node ast.Node) bool {
		call, ok := node.(*ast.CallExpr)
		if !ok {
			return true
		}
		method, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || method.Sel.Name != "Methods" {
			return true
		}
		registration, ok := method.X.(*ast.CallExpr)
		if !ok {
			panic("unsupported route registration")
		}
		selector, ok := registration.Fun.(*ast.SelectorExpr)
		if !ok || selector.Sel.Name != "HandleFunc" || len(registration.Args) != 2 {
			panic("unsupported route registration")
		}
		handled[registration] = true
		var handler bytes.Buffer
		if err := format.Node(&handler, fset, registration.Args[1]); err != nil {
			panic(err)
		}
		for _, arg := range call.Args {
			verb := literal(arg)
			if verb != "OPTIONS" {
				routes = append(routes, route{verb, literal(registration.Args[0]), handler.String(), fset.Position(registration.Pos()).Line})
			}
		}
		return true
	})
	ast.Inspect(file, func(node ast.Node) bool {
		if call, ok := node.(*ast.CallExpr); ok {
			if sel, ok := call.Fun.(*ast.SelectorExpr); ok && (sel.Sel.Name == "HandleFunc" || sel.Sel.Name == "Handle" || sel.Sel.Name == "PathPrefix") && !handled[call] {
				panic("unaccounted route registration; extend the documentation extractor")
			}
		}
		return true
	})
	sort.Slice(routes, func(i, j int) bool {
		if routes[i].Path == routes[j].Path {
			return routes[i].Method < routes[j].Method
		}
		return routes[i].Path < routes[j].Path
	})
	if err := json.NewEncoder(os.Stdout).Encode(routes); err != nil {
		panic(err)
	}
}
