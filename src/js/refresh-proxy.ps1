$signature = @'
[DllImport("wininet.dll", SetLastError = true, CharSet=CharSet.Auto)]
public static extern bool InternetSetOption(IntPtr hInternet, int dwOption, IntPtr lpBuffer, int dwBufferLength);
'@

$INTERNET_OPTION_REFRESH = 37
$INTERNET_OPTION_SETTINGS_CHANGED = 39

try {
    $type = Add-Type -MemberDefinition $signature -Name WinINetProxy -Namespace PInvoke -PassThru
    [void]$type::InternetSetOption([IntPtr]::Zero, $INTERNET_OPTION_SETTINGS_CHANGED, [IntPtr]::Zero, 0)
    [void]$type::InternetSetOption([IntPtr]::Zero, $INTERNET_OPTION_REFRESH, [IntPtr]::Zero, 0)
} catch {
    # Non-fatal if wininet already notified
}
