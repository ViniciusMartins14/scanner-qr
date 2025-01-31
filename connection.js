import mysql from "mysql2/promise";

export const connectToDatabase = await mysql.createConnection({
  host: "cpro44142.publiccloud.com.br",
  user: "sales",
  password: "hyaSAlec236x@",
  database: "sales",
});
