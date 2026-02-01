import os
import glob

tawk_script = '''
    <!--Start of Tawk.to Script-->
    <script type="text/javascript">
    var Tawk_API=Tawk_API||{}, Tawk_LoadStart=new Date();
    (function(){
        var s1=document.createElement("script"),s0=document.getElementsByTagName("script")[0];
        s1.async=true;
        s1.src='https://embed.tawk.to/697ef5aa8885d11c394b34a2/1jgbuv90o';
        s1.charset='UTF-8';
        s1.setAttribute('crossorigin','*');
        s0.parentNode.insertBefore(s1,s0);
    })();
    </script>
    <!--End of Tawk.to Script-->
</body>'''

html_files = glob.glob('C:/dev/FsuelsBot/workspace/ghost-broker/website/*.html')
updated = 0

for f in html_files:
    with open(f, 'r', encoding='utf-8') as file:
        content = file.read()
    
    # Skip if already has Tawk.to
    if 'Tawk.to Script' in content:
        print(f'SKIP (already has): {os.path.basename(f)}')
        continue
    
    # Replace </body> with tawk script + </body>
    if '</body>' in content:
        new_content = content.replace('</body>', tawk_script)
        with open(f, 'w', encoding='utf-8') as file:
            file.write(new_content)
        print(f'ADDED: {os.path.basename(f)}')
        updated += 1
    else:
        print(f'NO BODY TAG: {os.path.basename(f)}')

print(f'\nTotal updated: {updated}')
