$headers = @{
    "Authorization" = "Bearer zI_1jQMQVKViC4bCfXZn6nxD02LE37ptryCEo-8z"
    "Content-Type" = "application/json"
}

$r = Invoke-RestMethod -Uri "https://api.cloudflare.com/client/v4/zones?name=ghostbrokerai.xyz" -Headers $headers
$r.result | Format-Table id, name
