import os
import re

def parse_schema(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        lines = f.readlines()
        
    blocks = {}
    out_lines = []
    
    current_block = None
    
    for line in lines:
        line_str = line.strip()
        if current_block is None:
            m = re.match(r'^(model|enum|generator|datasource)\s+(\w+)\s*\{', line_str)
            if m:
                btype, bname = m.group(1), m.group(2)
                current_block = {'type': btype, 'name': bname, 'lines': [], 'header': line}
                blocks[bname] = current_block
            else:
                out_lines.append(line)
        else:
            if line_str == '}':
                out_lines.append(current_block)
                current_block = None
            else:
                current_block['lines'].append(line)
                
    return out_lines, blocks

def main():
    master_out, master_blocks = parse_schema('schema_master.prisma')
    _, crm_blocks = parse_schema('schema_crm.prisma')

    for bname, crm_block in crm_blocks.items():
        if bname in master_blocks:
            # Merge fields
            master_block = master_blocks[bname]
            # Identify existing fields in master
            master_field_names = set()
            for line in master_block['lines']:
                s = line.strip()
                if s and not s.startswith('//') and not s.startswith('@@'):
                    first_word = s.split()[0]
                    master_field_names.add(first_word)
            
            # Add CRM fields that are not in master
            crm_lines_to_add = []
            comment_buffer = []
            for line in crm_block['lines']:
                s = line.strip()
                if not s:
                    comment_buffer = []
                elif s.startswith('//'):
                    comment_buffer.append(line)
                else:
                    first_word = s.split()[0]
                    is_duplicate = False
                    if first_word.startswith('@@'):
                        is_duplicate = any(s == m_line.strip() for m_line in master_block['lines'] if m_line.strip().startswith('@@'))
                    else:
                        is_duplicate = first_word in master_field_names
                        
                    if not is_duplicate:
                        crm_lines_to_add.extend(comment_buffer)
                        crm_lines_to_add.append(line)
                    
                    comment_buffer = []
                    
            if crm_lines_to_add:
                master_block['lines'].extend(crm_lines_to_add)
        else:
            # Add new block
            master_out.append(crm_block)

    # Write out the merged schema
    os.makedirs('backend/prisma', exist_ok=True)
    with open('backend/prisma/schema.prisma', 'w', encoding='utf-8') as f:
        for item in master_out:
            if isinstance(item, dict):
                f.write(item['header'])
                for line in item['lines']:
                    f.write(line)
                f.write('}\n')
            else:
                f.write(item)

if __name__ == '__main__':
    main()
