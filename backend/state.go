package main

import (
	"database/sql"
	"sync"
)

var db *sql.DB
var alertChannel = make(chan Alert, 10)
var overlaySummaryMu sync.Mutex
